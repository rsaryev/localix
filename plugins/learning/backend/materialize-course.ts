import type { LearningCourse } from '../shared/contracts'
import type { LoadedCourseBundle } from './course-bundle'
import type { SessionCourseState } from './course-state'
import { lessons, lessonUnlocked, stepUnlocked } from '../shared/progression'
import { stepRevision } from './step-revision'

export function materializeCourse(
  sessionId: string,
  bundlePath: string,
  bundle: LoadedCourseBundle,
  state: SessionCourseState | null,
): LearningCourse {
  const all = lessons(bundle)
  const lessonIds = new Set(all.map((lesson) => lesson.id))
  const stepIds = new Set(all.flatMap((lesson) => lesson.steps.map((step) => step.id)))
  const changed = new Set(
    all
      .flatMap((lesson) => lesson.steps)
      .filter(
        (step) =>
          state?.stepRevisions?.[step.id] && state.stepRevisions[step.id] !== stepRevision(step),
      )
      .map((step) => step.id),
  )
  const now = new Date().toISOString()
  const course: LearningCourse = {
    ...bundle.outline,
    version: 4,
    id: bundle.id,
    sessionId,
    bundlePath,
    modules: bundle.modules,
    createdAt: state?.createdAt ?? now,
    updatedAt: state?.updatedAt ?? now,
    activeLessonId: state?.activeLessonId ?? all[0]?.id ?? null,
    activeStepId: state?.activeStepId ?? null,
    completedStepIds: (state?.completedStepIds ?? []).filter(
      (id) => stepIds.has(id) && !changed.has(id),
    ),
    progress: Object.fromEntries(
      Object.entries(state?.progress ?? {}).filter(([id]) => lessonIds.has(id)),
    ),
    assessments: Object.fromEntries(
      Object.entries(state?.assessments ?? {}).filter(
        ([id]) => stepIds.has(id) && !changed.has(id),
      ),
    ),
    generation: Object.fromEntries(
      Object.entries(state?.generation ?? {}).filter(([id]) =>
        bundle.modules.some(
          (module) =>
            module.id === id &&
            module.lessons.some((lesson) => lesson.generationStatus === 'pending'),
        ),
      ),
    ),
  }
  for (const lesson of all) {
    const progress = course.progress[lesson.id]
    if (
      progress?.status === 'completed' &&
      lesson.steps.some((step) => !course.completedStepIds.includes(step.id))
    )
      course.progress[lesson.id] = { ...progress, status: 'in-progress', score: undefined }
  }
  // An adapted course can insert a prerequisite. Never reopen a now-locked location.
  const active =
    all.find(
      (lesson) => lesson.id === course.activeLessonId && lessonUnlocked(course, lesson.id),
    ) ?? all.find((lesson) => lessonUnlocked(course, lesson.id))
  course.activeLessonId = active?.id ?? null
  course.activeStepId =
    active?.steps.find(
      (step) => step.id === course.activeStepId && stepUnlocked(course, active, step.id),
    )?.id ??
    active?.steps.find((step) => !course.completedStepIds.includes(step.id))?.id ??
    active?.steps[0]?.id ??
    null
  return course
}
