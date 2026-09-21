import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { User } from './user.entity';
import { Course } from './course.entity';
import { CourseLesson } from './course-lesson.entity';

@Entity('lesson_progress')
@Unique('uq_lesson_progress_student_lesson', ['studentId', 'lessonId'])
export class LessonProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  studentId: string;

  @Column()
  courseId: string;

  @Column()
  lessonId: string;

  /** 最远有效播放位置（秒），只增不减 */
  @Column({ type: 'double precision', default: 0 })
  position: number;

  /** 课时总时长（秒），取上报时与元数据一致的最大值 */
  @Column({ type: 'double precision', default: 0 })
  duration: number;

  /** 是否完成（播放到总时长 95% 即完成，完成后不可回退） */
  @Column({ default: false })
  completed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'studentId' })
  student: User;

  @ManyToOne(() => Course)
  @JoinColumn({ name: 'courseId' })
  course: Course;

  @ManyToOne(() => CourseLesson)
  @JoinColumn({ name: 'lessonId' })
  lesson: CourseLesson;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
