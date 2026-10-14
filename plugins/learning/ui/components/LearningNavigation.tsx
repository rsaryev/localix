import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { SectionLabel } from '@localixai/kit/section-label'
import { Spinner } from '@localixai/kit/spinner'
import type { LearningCourse, Lesson, LessonStep, ModuleGeneration } from '../../shared/contracts'
import { courseLessons, previousLesson } from '../model/course'
import { stepCompleted, stepTitle } from '../../shared/progression'

export function PendingLessonView({
  lesson,
  generation,
}: {
  lesson: Lesson
  generation?: ModuleGeneration
}) {
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-auto" data-scrollable>
      <section className="mx-auto w-full max-w-(--reading-measure) space-y-6 px-4 py-6 @2xl:px-8 @2xl:py-8">
        <div className="space-y-3">
          <SectionLabel>Next lesson · {lesson.estimatedMinutes} min</SectionLabel>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{lesson.title}</h1>
          <p className="text-sm/7 text-text-soft text-pretty">{lesson.summary}</p>
        </div>
        <div className="space-y-3 border-t border-border-soft pt-6">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            {generation?.status !== 'failed' && <Spinner className="size-3.5" />}
            {generation?.status === 'failed'
              ? 'Module preparation is paused'
              : 'Your next module is being prepared'}
          </h2>
          <p className="text-sm/6 text-text-soft">
            The tutor prepares whole modules using your course goal and earlier attempts. Your
            progress is saved.
          </p>
          <p role="status" className="text-xs/5 text-text-faint">
            {generation?.status === 'failed'
              ? 'The tutor could not finish preparing this module. Continue in the course’s conversation to resolve it.'
              : 'This lesson opens here as soon as its module is ready. You can revisit completed material while the tutor works.'}
          </p>
        </div>
      </section>
    </div>
  )
}

export function LearningFooter({
  course,
  lesson,
  step,
  busy,
  recalled,
  onBack,
  onForward,
}: {
  course: LearningCourse
  lesson: Lesson
  step: LessonStep | null
  busy: boolean
  recalled: boolean
  onBack: () => void
  onForward: () => void
}) {
  const all = courseLessons(course)
  const completed = all.filter(
    (item) => course.progress[item.lesson.id]?.status === 'completed',
  ).length
  const index = step ? lesson.steps.findIndex((item) => item.id === step.id) : -1
  const done = completed === all.length
  const assessment = step && course.assessments?.[step.id]
  const allowed =
    !!step &&
    (stepCompleted(course, lesson, step.id) ||
      (step.type === 'quiz'
        ? assessment?.correct
        : step.type === 'practice'
          ? assessment?.passed
          : step.type === 'flashcards'
            ? recalled
            : true))
  const action =
    index === lesson.steps.length - 1
      ? lesson.id === all.at(-1)?.lesson.id
        ? 'Complete course'
        : 'Next lesson'
      : 'Continue'
  return (
    <footer className="flex min-h-[var(--panel-header-height)] shrink-0 flex-wrap items-center gap-3 border-t border-border-soft px-3 py-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || (index <= 0 && !previousLesson(course, lesson.id))}
        onClick={onBack}
      >
        <ChevronLeft aria-hidden="true" />
        <span className="hidden @sm:inline">Previous</span>
      </Button>
      <div className="min-w-0 flex-1 text-center">
        <span className="block truncate text-2xs font-medium text-text-soft">
          {step ? stepTitle(step) : lesson.title}
        </span>
        <span className="block text-2xs tabular-nums text-text-faint">
          {step ? `Step ${index + 1} of ${lesson.steps.length} · ` : ''}
          {completed}/{all.length} lessons complete
        </span>
      </div>
      {lesson.generationStatus === 'pending' ? (
        <span className="text-2xs text-text-faint">Awaiting material</span>
      ) : done ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 text-xs text-status-success"
        >
          <Check className="size-3.5" aria-hidden="true" />
          Course complete
        </span>
      ) : (
        <Button type="button" size="sm" disabled={!allowed || busy} onClick={onForward}>
          {busy
            ? 'Saving…'
            : allowed
              ? action
              : step?.type === 'practice'
                ? 'Pass practice to continue'
                : step?.type === 'flashcards'
                  ? 'Recall cards to continue'
                  : 'Answer to continue'}
          <ChevronRight aria-hidden="true" />
        </Button>
      )}
    </footer>
  )
}
