import { localixResourceUri, parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

export const LEARNING_RESOURCE_PROVIDER = 'learning'

export type LearningResourceNode =
  | { kind: 'course'; courseId: string }
  | { kind: 'module'; courseId: string; moduleId: string }
  | { kind: 'lesson'; courseId: string; moduleId: string; lessonId: string }
  | {
      kind: 'step'
      courseId: string
      moduleId: string
      lessonId: string
      stepId: string
    }

export function learningCourseUri(courseId: string): string {
  return localixResourceUri(LEARNING_RESOURCE_PROVIDER, [courseId])
}

export function learningModuleUri(courseId: string, moduleId: string): string {
  return localixResourceUri(LEARNING_RESOURCE_PROVIDER, [courseId, 'module', moduleId])
}

export function learningLessonUri(courseId: string, moduleId: string, lessonId: string): string {
  return localixResourceUri(LEARNING_RESOURCE_PROVIDER, [
    courseId,
    'module',
    moduleId,
    'lesson',
    lessonId,
  ])
}

export function learningStepUri(
  courseId: string,
  moduleId: string,
  lessonId: string,
  stepId: string,
): string {
  return localixResourceUri(LEARNING_RESOURCE_PROVIDER, [
    courseId,
    'module',
    moduleId,
    'lesson',
    lessonId,
    'step',
    stepId,
  ])
}

export function parseLearningResourceUri(uri: string): LearningResourceNode | null {
  const parsed = parseLocalixUri(uri)
  if (parsed?.primitive !== 'resource') return null
  const [provider, courseId, moduleLevel, moduleId, lessonLevel, lessonId, stepLevel, stepId] =
    parsed.breadcrumbs
  if (provider !== LEARNING_RESOURCE_PROVIDER || !courseId) return null
  if (parsed.breadcrumbs.length === 2) return { kind: 'course', courseId }
  if (parsed.breadcrumbs.length === 4 && moduleLevel === 'module' && moduleId) {
    return { kind: 'module', courseId, moduleId }
  }
  if (
    parsed.breadcrumbs.length === 6 &&
    moduleLevel === 'module' &&
    moduleId &&
    lessonLevel === 'lesson' &&
    lessonId
  ) {
    return { kind: 'lesson', courseId, moduleId, lessonId }
  }
  if (
    parsed.breadcrumbs.length === 8 &&
    moduleLevel === 'module' &&
    moduleId &&
    lessonLevel === 'lesson' &&
    lessonId &&
    stepLevel === 'step' &&
    stepId
  ) {
    return { kind: 'step', courseId, moduleId, lessonId, stepId }
  }
  return null
}
