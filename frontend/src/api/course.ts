import { api } from './index';
import { Course, CourseLesson, CourseEnrollment, CourseProgress, LessonProgress, CourseType } from '@/types/course';

export const courseApi = {
  list: (params?: { category?: string; tag?: string; type?: CourseType; keyword?: string }) =>
    api.get<Course[]>('/courses', { params }).then(res => res.data),
  getMyCourses: () => api.get<Course[]>('/courses/my').then(res => res.data),
  get: (id: string) => api.get<Course>(`/courses/${id}`).then(res => res.data),
  create: (data: Partial<Course>) => api.post<Course>('/courses', data).then(res => res.data),
  update: (id: string, data: Partial<Course>) => api.put<Course>(`/courses/${id}`, data).then(res => res.data),
  publish: (id: string) => api.post<Course>(`/courses/${id}/publish`).then(res => res.data),
  enroll: (id: string) => api.post<CourseEnrollment>(`/courses/${id}/enroll`).then(res => res.data),
  getEnrollment: (id: string) => api.get<CourseEnrollment | null>(`/courses/${id}/enrollment`).then(res => res.data),
  createLesson: (courseId: string, data: Partial<CourseLesson>) =>
    api.post<CourseLesson>(`/courses/${courseId}/lessons`, data).then(res => res.data),
  getLesson: (lessonId: string) => api.get<CourseLesson>(`/courses/lessons/${lessonId}`).then(res => res.data),
  getCourseProgress: (courseId: string) =>
    api.get<CourseProgress>(`/courses/${courseId}/progress`).then(res => res.data),
  getLessonProgress: (lessonId: string) =>
    api.get<LessonProgress | null>(`/courses/lessons/${lessonId}/progress`).then(res => res.data),
  reportLessonProgress: (lessonId: string, data: { position: number; duration: number }) =>
    api.post<LessonProgress>(`/courses/lessons/${lessonId}/progress`, data).then(res => res.data),
};
