import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, GraduationCap } from 'lucide-react'
import {
  resourceMessageBindingDraft,
  useProblemReport,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { miniAppComposer } from '@localixai/mini-app-sdk/ui/runtime'
import { useComments, useScopeComments } from '@localixai/mini-app-sdk/ui/comments'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'
import { Button } from '@localixai/kit/button'
import { BreadcrumbSelect, type BreadcrumbSelectItem } from '@localixai/kit/breadcrumb-select'
import {
  CommentsManager,
  TextCommentLayer,
  type AnchoredTextComment,
} from '@localixai/kit/comments'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchBreadcrumb } from '@localixai/kit/workbench-breadcrumb'
import { learningCourseUri, learningLessonUri, learningStepUri } from '../shared/resource-uri'
import { lessonUnlocked, stepCompleted, stepUnlocked, stepTitle } from '../shared/progression'
import { taskContent } from '../shared/task-content'
import { LessonStepRail, LessonStepView } from './components/LessonSteps'
import { LearningFooter, PendingLessonView } from './components/LearningNavigation'
import { useLearningCourse } from './model/useLearningCourse'
import { commentsText } from './model/comments'
import { openLearningLibrary } from './model/openCourse'

export function LearningWorkspace({
  sessionId,
  courseId,
  visible = true,
  publishMessageContext,
  initialResourceUri,
}: {
  sessionId: string
  courseId: string
  visible?: boolean
  publishMessageContext?: PublishMessageContext
  initialResourceUri?: string
}) {
  const state = useLearningCourse(sessionId, courseId, visible, initialResourceUri)
  const { course, location, step } = state
  const courseTitle = course?.title
  const loaded = !!course
  const [recall, setRecall] = useState<{ key: string; ready: boolean } | null>(null)
  const stepKey = step ? `${courseId}:${step.id}:${taskContent(step)}` : ''
  const activeUri =
    course && location
      ? step
        ? learningStepUri(course.id, location.module.id, location.lesson.id, step.id)
        : learningLessonUri(course.id, location.module.id, location.lesson.id)
      : learningCourseUri(courseId)
  const commentScope = `learning:${sessionId}:${courseId}:${location?.lesson.id ?? 'none'}:${step?.id ?? 'outline'}`
  const comments = useScopeComments(commentScope)
  const addComment = useComments((value) => value.add)
  const updateComment = useComments((value) => value.setBody)
  const removeComment = useComments((value) => value.remove)
  const clearComments = useComments((value) => value.clearScope)
  const anchoredComments = useMemo<AnchoredTextComment[]>(
    () =>
      comments.map((comment) => ({
        id: comment.id,
        quote: comment.anchor.context ?? '',
        note: comment.body,
      })),
    [comments],
  )
  const bindingLabel = location
    ? `${courseTitle} · ${location.lesson.title}${step ? ` · ${stepTitle(step)}` : ''}`
    : null
  useEffect(() => {
    if (!visible || !bindingLabel || !publishMessageContext) return
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: activeUri,
          label: bindingLabel,
        }),
      ],
    })
    return () => publishMessageContext(null)
  }, [activeUri, bindingLabel, publishMessageContext, visible])
  const report = useMemo<ProblemReport | null>(
    () =>
      state.failure
        ? {
            subject: { label: courseTitle ?? 'Course' },
            problems: [{ severity: 'error', ...state.failure }],
            consequence: loaded ? (state.failureIsWrite ? 'none' : 'stale') : 'blocked',
          }
        : null,
    [courseTitle, loaded, state.failure, state.failureIsWrite],
  )
  const problem = useProblemReport(report, { scope: 'learning', sourceVisible: visible })
  if (state.loading) return <LoadingHint>Opening Learning Studio…</LoadingHint>
  if (!course || !location)
    return (
      <div className="flex h-full min-h-0 flex-col text-foreground">
        <PanelHeader tone="content" title="Learning" />
        {problem ? (
          <ProblemLine {...problem} className="px-4 py-3" />
        ) : (
          <StateNotice
            icon={GraduationCap}
            title="Course unavailable"
            body="The course may have been removed from the library."
          />
        )}
      </div>
    )
  const title = step ? stepTitle(step) : location.lesson.title
  const stageComments = () => {
    if (!comments.length) return
    miniAppComposer.insert({
      sessionId,
      text: commentsText(`${course.title} · ${title}`, comments),
      bindings: [resourceMessageBindingDraft({ uri: activeUri, label: title })],
    })
    clearComments(commentScope)
  }
  const moduleItems: BreadcrumbSelectItem[] = course.modules.map((module) => {
    const target =
      module.lessons.find(
        (lesson) =>
          lessonUnlocked(course, lesson.id) && course.progress[lesson.id]?.status !== 'completed',
      ) ?? module.lessons.find((lesson) => lessonUnlocked(course, lesson.id))
    return {
      id: module.id,
      label: module.title,
      active: module.id === location.module.id,
      disabled: !target || state.busy,
      onSelect: () => {
        if (target) void state.choose(target.id)
      },
    }
  })
  const lessonItems: BreadcrumbSelectItem[] = location.module.lessons.map((lesson) => ({
    id: lesson.id,
    label: lesson.title,
    active: lesson.id === location.lesson.id,
    disabled: state.busy || !lessonUnlocked(course, lesson.id),
    onSelect: () => void state.choose(lesson.id),
  }))
  const quizzes = location.lesson.steps.filter((item) => item.type === 'quiz')
  const recalled = recall?.key === stepKey && recall.ready
  return (
    <div className="@container flex h-full min-h-0 w-full min-w-0 flex-col text-foreground">
      <PanelHeader
        tone="content"
        title={<span className="truncate text-xs font-medium">{course.title}</span>}
        actions={
          <CommentsManager
            comments={comments}
            submitLabel="Add to message"
            onRemove={removeComment}
            onClear={() => clearComments(commentScope)}
            onSubmit={stageComments}
          />
        }
      />
      <WorkbenchBreadcrumb
        aria-label="Course path"
        bordered
        className="h-[var(--panel-header-height)] shrink-0 px-3"
      >
        <li className="flex min-w-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Back to courses"
            onClick={() => openLearningLibrary(sessionId)}
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            Courses
          </Button>
        </li>
        <li className="shrink-0 text-text-faint" aria-hidden="true">
          /
        </li>
        <li className="flex min-w-0 items-center">
          <BreadcrumbSelect
            label={location.module.title}
            items={moduleItems}
            ariaLabel="Switch module"
            className="max-w-48"
          />
        </li>
        <li className="shrink-0 text-text-faint" aria-hidden="true">
          /
        </li>
        <li className="flex min-w-0 items-center">
          <BreadcrumbSelect
            label={location.lesson.title}
            items={lessonItems}
            ariaLabel="Switch lesson"
            className="max-w-56 text-foreground"
          />
        </li>
      </WorkbenchBreadcrumb>
      {step && (
        <LessonStepRail
          steps={location.lesson.steps}
          activeStepId={step.id}
          completedStepIds={
            new Set(
              location.lesson.steps
                .filter((item) => stepCompleted(course, location.lesson, item.id))
                .map((item) => item.id),
            )
          }
          unlockedStepIds={
            new Set(
              location.lesson.steps
                .filter((item) => !state.busy && stepUnlocked(course, location.lesson, item.id))
                .map((item) => item.id),
            )
          }
          onSelect={(id) => void state.choose(location.lesson.id, id)}
        />
      )}
      {location.lesson.generationStatus === 'pending' ? (
        <PendingLessonView
          key={location.lesson.id}
          lesson={location.lesson}
          generation={course.generation?.[location.module.id]}
        />
      ) : step ? (
        <TextCommentLayer
          comments={anchoredComments}
          onAdd={(quote, note) =>
            addComment(
              commentScope,
              {
                kind: 'learning-text',
                targetId: activeUri,
                label: 'Selected text',
                groupId: activeUri,
                groupLabel: title,
                context: quote,
              },
              note,
            )
          }
          onUpdate={updateComment}
          onRemove={removeComment}
          active={visible}
          className="h-0 min-h-0 flex-1"
          contentClassName="mx-auto w-full max-w-(--reading-measure) px-4 py-6 @2xl:px-8 @2xl:py-8"
        >
          <article>
            <LessonStepView
              key={stepKey}
              step={step}
              quizPosition={
                step.type === 'quiz'
                  ? {
                      current: quizzes.findIndex((item) => item.id === step.id) + 1,
                      total: quizzes.length,
                    }
                  : undefined
              }
              assessment={course.assessments?.[step.id]}
              onAnswer={() => {}}
              onSubmitAnswer={state.submitAnswer}
              onSubmitPractice={state.submitPractice}
              onRecallReady={(ready) => setRecall({ key: stepKey, ready })}
            />
          </article>
        </TextCommentLayer>
      ) : (
        <LoadingHint>Preparing lesson…</LoadingHint>
      )}
      <div className="relative shrink-0">
        {problem && (
          <ProblemLine
            {...problem}
            className="lx-occluder absolute inset-x-0 bottom-full z-(--z-raised) border-t border-border-soft px-3 py-2 shadow-(--shadow-raised)"
          />
        )}
        <LearningFooter
          course={course}
          lesson={location.lesson}
          step={step}
          busy={state.busy}
          recalled={recalled}
          onBack={() => void state.back()}
          onForward={() => void state.forward(recalled)}
        />
      </div>
    </div>
  )
}
