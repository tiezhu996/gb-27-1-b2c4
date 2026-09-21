import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, EntityManager } from 'typeorm';
import { Course, CourseType, CourseStatus } from '../../common/entities/course.entity';
import { CourseLesson } from '../../common/entities/course-lesson.entity';
import { CourseEnrollment, EnrollmentStatus } from '../../common/entities/course-enrollment.entity';
import { LessonProgress } from '../../common/entities/lesson-progress.entity';
import { UserRole } from '../../common/entities/user.entity';

/** 播放到总时长的该比例即标记课时完成 */
const COMPLETION_THRESHOLD = 0.95;

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course)
    private readonly courseRepository: Repository<Course>,
    @InjectRepository(CourseLesson)
    private readonly lessonRepository: Repository<CourseLesson>,
    @InjectRepository(CourseEnrollment)
    private readonly enrollmentRepository: Repository<CourseEnrollment>,
    @InjectRepository(LessonProgress)
    private readonly progressRepository: Repository<LessonProgress>,
  ) {}

  async findAll(query: { category?: string; tag?: string; type?: CourseType; keyword?: string }) {
    const where: any = { status: CourseStatus.PUBLISHED };
    
    if (query.category) where.category = query.category;
    if (query.type) where.type = query.type;
    if (query.keyword) where.name = Like(`%${query.keyword}%`);
    
    const courses = await this.courseRepository.find({
      where,
      relations: ['teacher'],
      order: { createdAt: 'DESC' },
    });
    
    if (query.tag) {
      return courses.filter(course => 
        course.tags && course.tags.includes(query.tag)
      );
    }
    
    return courses;
  }

  async findMyCourses(userId: string, role: UserRole) {
    if (role === UserRole.TEACHER) {
      return this.courseRepository.find({
        where: { teacherId: userId },
        relations: ['teacher', 'lessons'],
        order: { createdAt: 'DESC' },
      });
    }
    
    if (role === UserRole.STUDENT) {
      const enrollments = await this.enrollmentRepository.find({
        where: { studentId: userId },
        relations: ['course', 'course.teacher'],
      });
      return enrollments.map(e => e.course);
    }
    
    return [];
  }

  async findOne(id: string) {
    const course = await this.courseRepository.findOne({
      where: { id },
      relations: ['teacher', 'lessons'],
    });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    return course;
  }

  async create(userId: string, courseData: Partial<Course>) {
    const course = this.courseRepository.create({
      ...courseData,
      teacherId: userId,
      status: CourseStatus.DRAFT,
    });
    return this.courseRepository.save(course);
  }

  async update(userId: string, id: string, courseData: Partial<Course>) {
    const course = await this.courseRepository.findOne({ where: { id } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (course.teacherId !== userId) {
      throw new ForbiddenException('无权修改此课程');
    }
    
    Object.assign(course, courseData);
    return this.courseRepository.save(course);
  }

  async publish(userId: string, id: string) {
    return this.update(userId, id, { status: CourseStatus.PUBLISHED });
  }

  async enroll(studentId: string, courseId: string) {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    
    const existingEnrollment = await this.enrollmentRepository.findOne({
      where: { studentId, courseId },
    });
    
    if (existingEnrollment) {
      return existingEnrollment;
    }
    
    const enrollment = this.enrollmentRepository.create({
      studentId,
      courseId,
      enrolledAt: new Date(),
    });
    
    return this.enrollmentRepository.save(enrollment);
  }

  async getEnrollment(studentId: string, courseId: string) {
    return this.enrollmentRepository.findOne({
      where: { studentId, courseId },
    });
  }

  async createLesson(userId: string, courseId: string, lessonData: Partial<CourseLesson>) {
    const course = await this.courseRepository.findOne({ where: { id: courseId } });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    if (course.teacherId !== userId) {
      throw new ForbiddenException('无权操作此课程');
    }
    
    const maxOrder = await this.lessonRepository
      .createQueryBuilder('lesson')
      .where('lesson.courseId = :courseId', { courseId })
      .select('MAX(lesson.order)', 'max')
      .getRawOne();
    
    const lesson = this.lessonRepository.create({
      ...lessonData,
      courseId,
      order: (maxOrder?.max || 0) + 1,
    });
    
    return this.lessonRepository.save(lesson);
  }

  async findLesson(id: string) {
    const lesson = await this.lessonRepository.findOne({
      where: { id },
      relations: ['course'],
    });
    if (!lesson) {
      throw new NotFoundException('课时不存在');
    }
    return lesson;
  }

  /**
   * 上报录播学习进度。
   * - 仅已登录且已选课的学生可上报
   * - 同一学生同一课时只保留最远有效位置（只增不减，拖动/重复/并发均不得回退）
   * - 播放到总时长 95% 标记完成，完成后不被后续低进度覆盖
   */
  async reportProgress(
    studentId: string,
    role: UserRole,
    lessonId: string,
    data: { position: number; duration: number },
  ): Promise<LessonProgress> {
    if (role !== UserRole.STUDENT) {
      throw new ForbiddenException('只有学生可以上报学习进度');
    }

    const lesson = await this.lessonRepository.findOne({ where: { id: lessonId } });
    if (!lesson) {
      throw new NotFoundException('课时不存在');
    }
    if (lesson.isLive) {
      throw new BadRequestException('直播课时不支持学习进度上报');
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId, courseId: lesson.courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException('请先报名该课程');
    }

    if (!(data.position >= 0) || !(data.duration >= 0)) {
      throw new BadRequestException('播放位置和总时长必须是非负数');
    }
    if (data.duration <= 0) {
      throw new BadRequestException('课时总时长无效');
    }

    // 有效位置不得超过总时长
    const position = Math.min(data.position, data.duration);
    const reachesCompletion = position >= data.duration * COMPLETION_THRESHOLD;

    return this.progressRepository.manager.transaction(async (manager) => {
      let progress = await manager.findOne(LessonProgress, {
        where: { studentId, lessonId },
      });

      if (!progress) {
        // 并发插入时依赖 (studentId, lessonId) 唯一索引兜底
        try {
          progress = await manager.save(LessonProgress, manager.create(LessonProgress, {
            studentId,
            courseId: lesson.courseId,
            lessonId,
            position,
            duration: data.duration,
            completed: reachesCompletion,
            completedAt: reachesCompletion ? new Date() : null,
          }));
        } catch (err: any) {
          if (err?.code !== '23505') throw err;
          progress = await manager.findOne(LessonProgress, {
            where: { studentId, lessonId },
          });
        }
      }

      if (progress) {
        // 已完成永久保持完成；位置只取最远值；拖动/重复/并发上报均无法使其回退
        const willComplete = progress.completed || reachesCompletion;
        const result = await manager
          .createQueryBuilder()
          .update(LessonProgress)
          .set({
            position: () => 'GREATEST("position", :position)',
            duration: () => 'GREATEST("duration", :duration)',
            completed: willComplete,
            completedAt: () =>
              willComplete
                ? 'COALESCE("completedAt", :now)'
                : '"completedAt"',
          })
          .where('id = :id')
          .andWhere('(:position > "position" OR (:reaches = true AND completed = false))')
          .setParameters({
            id: progress.id,
            position,
            duration: data.duration,
            reaches: reachesCompletion,
            now: new Date(),
          })
          .execute();

        if (result.affected && result.affected > 0) {
          progress = await manager.findOneByOrFail(LessonProgress, { id: progress.id });
        }
      }

      await this.recalculateEnrollment(manager, studentId, lesson.courseId);
      return progress;
    });
  }

  /** 查询学生在单个课时的进度（含续播位置与完成状态） */
  async getLessonProgress(
    studentId: string,
    lessonId: string,
  ): Promise<LessonProgress | null> {
    const lesson = await this.lessonRepository.findOne({ where: { id: lessonId } });
    if (!lesson) {
      throw new NotFoundException('课时不存在');
    }
    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId, courseId: lesson.courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException('请先报名该课程');
    }

    return this.progressRepository.findOne({
      where: { studentId, lessonId },
    });
  }

  /**
   * 查询课程详情中面向已选课学生的学习状态：
   * 课程总进度 + 每个课时的进度、续播位置、完成状态。刷新后可直接回读。
   */
  async getCourseProgress(studentId: string, courseId: string) {
    const course = await this.courseRepository.findOne({
      where: { id: courseId },
      relations: ['lessons'],
    });
    if (!course) {
      throw new NotFoundException('课程不存在');
    }
    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId, courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException('请先报名该课程');
    }

    const lessons = (course.lessons || []).sort((a, b) => a.order - b.order);
    const progressList = await this.progressRepository.find({
      where: { studentId, courseId },
    });
    const progressMap = new Map(progressList.map((p) => [p.lessonId, p]));

    return {
      enrollment: {
        id: enrollment.id,
        progress: Number(enrollment.progress),
        status: enrollment.status,
      },
      lessons: lessons.map((lesson) => {
        const p = progressMap.get(lesson.id);
        return {
          lessonId: lesson.id,
          isLive: lesson.isLive,
          position: p ? Number(p.position) : 0,
          duration: p ? Number(p.duration) : 0,
          completed: p ? p.completed : false,
          completedAt: p?.completedAt || null,
          updatedAt: p?.updatedAt || null,
        };
      }),
    };
  }

  /**
   * 按已完成课时重算课程进度。
   * 课程进度 = 已完成录播课时数 / 录播课时总数 * 100；直播课时不计入。
   * 全部完成时课程标记为 completed。
   */
  private async recalculateEnrollment(
    manager: EntityManager,
    studentId: string,
    courseId: string,
  ): Promise<void> {
    const recordedLessons = await manager.find(CourseLesson, {
      where: { courseId, isLive: false },
    });

    let progress = 0;
    let status: EnrollmentStatus = EnrollmentStatus.ACTIVE;

    if (recordedLessons.length > 0) {
      const completedCount = await manager.count(LessonProgress, {
        where: { studentId, courseId, completed: true },
      });
      progress = Math.round((completedCount / recordedLessons.length) * 10000) / 100;
      if (completedCount === recordedLessons.length) {
        status = EnrollmentStatus.COMPLETED;
      }
    }

    await manager.update(
      CourseEnrollment,
      { studentId, courseId },
      { progress, status },
    );
  }
}
