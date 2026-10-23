import { lazy, Suspense } from 'react'
import { BookOpen, GraduationCap, Layers3 } from 'lucide-react'

import type { MiniAppUiHost, PublishMessageContext, WorkItemLike } from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { parseLearningResourceUri } from '../shared/resource-uri'
import { learningCourseTabId } from './model/openCourse'
import { initCourseChanges } from './model/courseChanges'
import { useLearningStatusItem } from './statusItem'

const LearningLibraryLazy = lazy(() =>
  import('./LearningLibrary').then((module) => ({
    default: module.LearningLibrary,
  })),
)

const LearningWorkspaceLazy = lazy(() =>
  import('./LearningWorkspace').then((module) => ({
    default: module.LearningWorkspace,
  })),
)

function LearningWorkspaceBody({
  item,
  visible,
  publishMessageContext,
}: {
  item: WorkItemLike
  visible: boolean
  publishMessageContext?: PublishMessageContext
}) {
  // The chat this tab belongs to, as the host states it — not the opaque `item.scope`, and never
  // the chat in front. Both kinds are session kinds, so a tab without one has no course to show.
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return null
  return (
    <Suspense fallback={<LoadingHint>Opening Learning Studio…</LoadingHint>}>
      <LearningWorkspaceLazy
        sessionId={sessionId}
        courseId={typeof item.payload?.courseId === 'string' ? item.payload.courseId : ''}
        visible={visible}
        publishMessageContext={publishMessageContext}
        initialResourceUri={
          typeof item.payload?.resourceUri === 'string' ? item.payload.resourceUri : undefined
        }
      />
    </Suspense>
  )
}

function LearningLibraryBody({ visible }: { visible: boolean }) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return null
  return (
    <Suspense fallback={<LoadingHint>Opening course library…</LoadingHint>}>
      <LearningLibraryLazy sessionId={sessionId} visible={visible} />
    </Suspense>
  )
}

let registered = false

export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true
  initCourseChanges()

  host.workItems.register({
    kind: 'learning:workspace',
    Component: LearningLibraryBody,
    Icon: GraduationCap,
    restorable: true,
    scope: 'session',
    agentContext: {
      description: 'Adaptive course library for the Localix session this tab belongs to.',
      tools: ['learning_course'],
      nextSteps: [
        'List available courses with learning_course.',
        'Open or create the course matching the learning goal.',
      ],
    },
  })

  host.workItems.register({
    kind: 'learning:course',
    Component: LearningWorkspaceBody,
    Icon: BookOpen,
    restorable: true,
    scope: 'session',
    siblingGroupKey: () => 'learning-courses',
    agentContext: {
      description: 'Active learning course, lesson progress, and tutor workspace.',
      tools: ['learning_course'],
      nextSteps: [
        'Inspect the current lesson and progress.',
        'Continue the next lesson or answer the learner’s current question.',
      ],
    },
  })

  // Course progress in the titlebar — the number that lives inside the tab you cannot see
  // while you are anywhere else.
  host.statusItems.register({
    id: 'learning:progress',
    placement: 'titlebar',
    useItem: useLearningStatusItem,
  })

  host.railViewlets.register({
    kind: 'learning:workspace',
    title: 'Learning Studio',
    label: 'Learning Studio — adaptive courses & tutor',
    defaultArea: 'overflow',
    keywords: [
      'learning',
      'course',
      'study',
      'education',
      'tutor',
      'lesson',
      'quiz',
      'practice',
      'adaptive',
      'learning path',
    ],
    Icon: GraduationCap,
  })

  host.anchors.register({
    id: 'learning:resources',
    namespaces: ['learning'],
    icons: {
      course: GraduationCap,
      module: Layers3,
      lesson: BookOpen,
      concept: BookOpen,
      code: BookOpen,
      quiz: BookOpen,
      flashcards: BookOpen,
      walkthrough: BookOpen,
      practice: BookOpen,
    },
    resolve: (id) => {
      const node = parseLearningResourceUri(id)
      if (!node) return null
      return {
        kind: 'work-item',
        workKind: 'learning:course',
        id: learningCourseTabId(node.courseId),
        title: 'Course',
        payload: { courseId: node.courseId, resourceUri: id },
      }
    },
  })
}
