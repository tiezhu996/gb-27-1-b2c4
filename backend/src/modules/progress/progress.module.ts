import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonProgress } from '../../common/entities/lesson-progress.entity';
import { CourseLesson } from '../../common/entities/course-lesson.entity';
import { CourseEnrollment } from '../../common/entities/course-enrollment.entity';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  imports: [TypeOrmModule.forFeature([LessonProgress, CourseLesson, CourseEnrollment])],
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
