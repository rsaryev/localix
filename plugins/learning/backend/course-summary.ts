import type { CourseSummary, LearningCourse } from '../shared/contracts'
import { lessons } from '../shared/progression'

export function courseSummary(course: LearningCourse): CourseSummary {
  const all = lessons(course)
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    sessionId: course.sessionId,
    level: course.level,
    language: course.language,
    estimatedMinutes: course.estimatedMinutes,
    updatedAt: course.updatedAt,
    completedLessons: all.filter((lesson) => course.progress[lesson.id]?.status === 'completed')
      .length,
    totalLessons: all.length,
  }
}
