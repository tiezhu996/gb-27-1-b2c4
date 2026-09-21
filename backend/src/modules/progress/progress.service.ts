import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { LessonProgress } from '../../common/entities/lesson-progress.entity';
import { CourseLesson } from '../../common/entities/course-lesson.entity';
import { CourseEnrollment, EnrollmentStatus } from '../../common/entities/course-enrollment.entity';
import { User, UserRole } from '../../common/entities/user.entity';
import { ReportProgressDto } from './dto/report-progress.dto';

// 播放进度达到总时长 95% 即视为完成
const COMPLETION_THRESHOLD = 0.95;

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(LessonProgress)
    private readonly progressRepository: Repository<LessonProgress>,
    @InjectRepository(CourseLesson)
    private readonly lessonRepository: Repository<CourseLesson>,
    @InjectRepository(CourseEnrollment)
    private readonly enrollmentRepository: Repository<CourseEnrollment>,
    private readonly dataSource: DataSource,
  ) {}

  async reportProgress(user: User, courseId: string, lessonId: string, dto: ReportProgressDto) {
    if (user.role !== UserRole.STUDENT) {
      throw new ForbiddenException('仅学生可以上报学习进度');
    }

    const lesson = await this.lessonRepository.findOne({ where: { id: lessonId } });
    if (!lesson || lesson.courseId !== courseId) {
      throw new NotFoundException('课时不存在');
    }
    if (lesson.isLive) {
      throw new BadRequestException('直播课时不支持录播进度上报');
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId: user.id, courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException('请先报名该课程');
    }

    const duration = Math.floor(dto.duration);
    const position = Math.min(Math.max(0, Math.floor(dto.position)), duration);

    return this.dataSource.transaction(async (manager) => {
      // 原子插入占位行，避免并发上报时唯一约束冲突
      await manager
        .createQueryBuilder()
        .insert()
        .into(LessonProgress)
        .values({ studentId: user.id, lessonId, courseId, position: 0, duration })
        .orIgnore()
        .execute();

      // 行级锁串行化并发更新，保证拖动、重复或并发上报不会回退
      const record = await manager
        .createQueryBuilder(LessonProgress, 'progress')
        .setLock('pessimistic_write')
        .where('progress.studentId = :studentId AND progress.lessonId = :lessonId', {
          studentId: user.id,
          lessonId,
        })
        .getOne();

      const wasCompleted = record.completed;

      // 只保留最远有效位置（已完成课时同样适用，保证并发结果与处理顺序无关；
      // 低进度上报天然被 max 逻辑拦截，不会覆盖已完成记录）
      if (position > record.position) {
        record.position = position;
      }
      record.duration = duration;

      // 完成状态一旦达成不再回退
      if (!record.completed && record.position >= record.duration * COMPLETION_THRESHOLD) {
        record.completed = true;
        record.completedAt = new Date();
      }

      const saved = await manager.save(record);

      if (!wasCompleted && saved.completed) {
        await this.recalculateCourseProgress(manager, user.id, courseId);
      }

      return saved;
    });
  }

  async getCourseProgress(user: User, courseId: string) {
    if (user.role !== UserRole.STUDENT) {
      throw new ForbiddenException('仅学生可以查看学习进度');
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId: user.id, courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException('请先报名该课程');
    }

    const records = await this.progressRepository.find({
      where: { studentId: user.id, courseId },
    });

    const totalLessons = await this.lessonRepository.count({
      where: { courseId, isLive: false },
    });

    return {
      courseProgress: Number(enrollment.progress) || 0,
      completedLessons: records.filter((r) => r.completed).length,
      totalLessons,
      lessons: records.map((r) => ({
        lessonId: r.lessonId,
        position: r.position,
        duration: r.duration,
        completed: r.completed,
        completedAt: r.completedAt,
      })),
    };
  }

  // 按已完成课时重算课程进度（直播课时不计入分母）
  private async recalculateCourseProgress(manager: EntityManager, studentId: string, courseId: string) {
    const totalLessons = await manager.count(CourseLesson, {
      where: { courseId, isLive: false },
    });
    if (totalLessons === 0) {
      return;
    }

    const completedLessons = await manager.count(LessonProgress, {
      where: { studentId, courseId, completed: true },
    });

    const progress = Math.round((completedLessons / totalLessons) * 10000) / 100;

    await manager.update(
      CourseEnrollment,
      { studentId, courseId },
      {
        progress,
        ...(progress >= 100 ? { status: EnrollmentStatus.COMPLETED } : {}),
      },
    );
  }
}
