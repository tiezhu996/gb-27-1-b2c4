import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { User } from './user.entity';
import { CourseLesson } from './course-lesson.entity';

@Entity('lesson_progress')
@Unique(['studentId', 'lessonId'])
export class LessonProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  studentId: string;

  @Column()
  lessonId: string;

  @Column()
  courseId: string;

  // 最远有效播放位置（秒），单调递增，不会回退
  @Column({ type: 'int', default: 0 })
  position: number;

  // 视频总时长（秒）
  @Column({ type: 'int', default: 0 })
  duration: number;

  @Column({ default: false })
  completed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'studentId' })
  student: User;

  @ManyToOne(() => CourseLesson)
  @JoinColumn({ name: 'lessonId' })
  lesson: CourseLesson;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
