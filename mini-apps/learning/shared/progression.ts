import type { LearningCourse, Lesson, LessonStep, LessonStepStage } from './contracts'

export function lessons(course: Pick<LearningCourse, 'modules'>): Lesson[] {
  return course.modules.flatMap((module) => module.lessons)
}

export function lessonUnlocked(course: LearningCourse, lessonId: string): boolean {
  const all = lessons(course)
  const index = all.findIndex((lesson) => lesson.id === lessonId)
  return (
    index >= 0 &&
    all.slice(0, index).every((lesson) => course.progress[lesson.id]?.status === 'completed')
  )
}

export function stepCompleted(course: LearningCourse, lesson: Lesson, stepId: string): boolean {
  return (
    course.progress[lesson.id]?.status === 'completed' || course.completedStepIds.includes(stepId)
  )
}

export function stepUnlocked(course: LearningCourse, lesson: Lesson, stepId: string): boolean {
  const index = lesson.steps.findIndex((step) => step.id === stepId)
  return (
    index >= 0 &&
    (course.progress[lesson.id]?.status === 'completed' ||
      lesson.steps.slice(0, index).every((step) => course.completedStepIds.includes(step.id)))
  )
}

export function stepStage(step: LessonStep): LessonStepStage {
  if (step.type === 'concept' || step.type === 'code' || step.type === 'walkthrough')
    return 'theory'
  if (step.type === 'quiz' || step.type === 'flashcards') return 'test'
  return 'practice'
}

export function stepTitle(step: LessonStep): string {
  return step.type === 'quiz' ? step.question : step.title
}

/** First attempts describe retrieval; retries must not turn every score into 100%. */
export function lessonScore(course: LearningCourse, lesson: Lesson): number | undefined {
  const answers = lesson.steps
    .filter((step) => step.type === 'quiz')
    .map((step) => course.assessments?.[step.id])
    .filter((answer) => answer?.firstCorrect !== undefined)
  return answers.length
    ? Math.round((answers.filter((answer) => answer?.firstCorrect).length / answers.length) * 100)
    : undefined
}
