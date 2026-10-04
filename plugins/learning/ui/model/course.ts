import type { CourseModule, LearningCourse, Lesson, LessonStep } from '../../shared/contracts'
export {
  lessonUnlocked,
  stepCompleted,
  stepUnlocked,
  stepStage,
  stepTitle,
} from '../../shared/progression'

export interface LessonLocation {
  module: CourseModule
  lesson: Lesson
  moduleIndex: number
  lessonIndex: number
}

export function courseLessons(course: LearningCourse): LessonLocation[] {
  return course.modules.flatMap((module, moduleIndex) =>
    module.lessons.map((lesson, lessonIndex) => ({
      module,
      lesson,
      moduleIndex,
      lessonIndex,
    })),
  )
}

export function activeLesson(course: LearningCourse): LessonLocation | null {
  const lessons = courseLessons(course)
  return lessons.find((entry) => entry.lesson.id === course.activeLessonId) ?? lessons[0] ?? null
}

export function activeStep(course: LearningCourse, lesson: Lesson): LessonStep | null {
  return lesson.steps.find((step) => step.id === course.activeStepId) ?? lesson.steps[0] ?? null
}

export function lessonNumber(course: LearningCourse, lessonId: string): number {
  return courseLessons(course).findIndex((entry) => entry.lesson.id === lessonId) + 1
}

export function nextLesson(course: LearningCourse, lessonId: string): LessonLocation | null {
  const lessons = courseLessons(course)
  const index = lessons.findIndex((entry) => entry.lesson.id === lessonId)
  return index >= 0 ? (lessons[index + 1] ?? null) : null
}

export function previousLesson(course: LearningCourse, lessonId: string): LessonLocation | null {
  const lessons = courseLessons(course)
  const index = lessons.findIndex((entry) => entry.lesson.id === lessonId)
  return index > 0 ? (lessons[index - 1] ?? null) : null
}
