import { lazy, Suspense } from 'react'
import { SquareKanban } from 'lucide-react'
import {
  resourceMessageBindingDraft,
  type MiniAppUiHost,
  type SessionSurfaceProps,
  type WorkItemLike,
} from '@localixai/mini-app-sdk/ui'
import { LoadingHint } from '@localixai/kit/empty-hint'

import { boardUri, BOARD_KIND, SEARCH_PROVIDER_ID, TASK_KIND, taskUri } from '../shared/resource'
import { KANBAN_TOOL } from '../shared/tool'
import { BOARD_TITLE, resolveKanbanAnchor } from './navigation'
import { KanbanCard } from './tool-card/KanbanCard'

const BoardTab = lazy(() => import('./board/board').then((m) => ({ default: m.BoardTab })))
const TaskTab = lazy(() => import('./board/task-panel').then((m) => ({ default: m.TaskTab })))
const BoardStrip = lazy(() =>
  import('./composer/BoardStrip').then((m) => ({ default: m.BoardStrip })),
)

function BoardBody() {
  return (
    <Suspense fallback={<LoadingHint>Opening the board…</LoadingHint>}>
      <BoardTab />
    </Suspense>
  )
}

function TaskBody({ item }: { item: WorkItemLike }) {
  return (
    <Suspense fallback={<LoadingHint>Opening the task…</LoadingHint>}>
      <TaskTab item={item} />
    </Suspense>
  )
}

/** Above the composer the strip is extra, never in the way: it loads with no placeholder. */
function ComposerHeader(props: SessionSurfaceProps) {
  return (
    <Suspense fallback={null}>
      <BoardStrip {...props} />
    </Suspense>
  )
}

const taskIdOf = (item: WorkItemLike) =>
  typeof item.payload?.taskId === 'string' ? item.payload.taskId : null

const registeredHosts = new WeakSet<MiniAppUiHost>()

/**
 * One board PER CHAT (`scope: 'session'`), kept by the person and the agent in that chat and
 * deleted with it. The host gives each chat its own board tab and closes it with the chat; a card
 * opened on its own is a second session tab beside it.
 *
 * A dragged or auto-linked tab links the board as a resource, naming the chat the host says the tab
 * belongs to; everything rendered reads the session from `useWorkItemSessionId`.
 */
export function registerUi(host: MiniAppUiHost): void {
  if (registeredHosts.has(host)) return
  registeredHosts.add(host)

  host.workItems.register({
    kind: BOARD_KIND,
    Component: BoardBody,
    Icon: SquareKanban,
    restorable: true,
    scope: 'session',
    agentContext: {
      description:
        'This chat’s task board: epics, tasks, dependencies, checklists, owners and blockers, kept by the user and you. The board records work; it never starts it.',
      tools: [KANBAN_TOOL],
      nextSteps: [
        'Read the board with kanban action "list" before you plan or report progress.',
        'Take a card with kanban action "take" before you work it; complete or block it when you stop.',
        'Put multi-part work on the board with kanban action "create", prerequisites first.',
      ],
    },
    toMessageBinding: (_item, { session }) =>
      session ? resourceMessageBindingDraft({ uri: boardUri(session), label: BOARD_TITLE }) : null,
  })
  host.workItems.register({
    kind: TASK_KIND,
    Component: TaskBody,
    Icon: SquareKanban,
    // No `placement`: a card is a document from the board, so it opens as a tab beside the board in
    // the editor area. It declared `aux`, the side panel conversations stack in, and every card
    // opened away from the board it came from.
    scope: 'session',
    agentContext: (item) => {
      const taskId = taskIdOf(item) ?? 'the card'
      return {
        description: `Card ${taskId} of this chat’s board, open on its own.`,
        tools: [KANBAN_TOOL],
        nextSteps: [`Read it with kanban action "detail" and task_id "${taskId}".`],
      }
    },
    toMessageBinding: (item, { session }) => {
      const taskId = taskIdOf(item)
      return session && taskId
        ? resourceMessageBindingDraft({ uri: taskUri(session, taskId), label: item.title })
        : null
    },
  })
  host.railViewlets.register({
    kind: BOARD_KIND,
    title: BOARD_TITLE,
    label: 'Board — this chat’s tasks',
    defaultArea: 'bar',
    keywords: ['kanban', 'board', 'tasks'],
    Icon: SquareKanban,
  })
  host.anchors.register({
    id: 'kanban:board-anchor',
    namespaces: ['kanban'],
    icons: { kanban: SquareKanban },
    resolve: resolveKanbanAnchor,
  })
  host.search.register({
    id: SEARCH_PROVIDER_ID,
    scope: { label: 'Tasks', prefix: 'task', aliases: ['kanban'], icon: 'kanban' },
    icons: { kanban: SquareKanban },
  })
  host.resourceRefIcons.register({ kanban: SquareKanban })
  host.toolCards.register({
    tool: KANBAN_TOOL,
    presentation: {
      label: 'Updated',
      noun: 'board tasks',
      verb: 'Updating',
      Icon: SquareKanban,
      stackable: true,
    },
    Component: KanbanCard,
  })
  host.sessionSurfaces.register({ surface: 'composer.header', Component: ComposerHeader })
  host.commentActions.register({
    id: 'kanban:task',
    label: 'Task',
    title: 'Create a board task from these comments',
    Icon: SquareKanban,
    run: async (batch) => (await import('./comment-action')).addCommentsToBoard(batch),
  })
}
