import type { ComponentProps } from 'react'
import {
  Boxes,
  Check,
  CheckCircle2,
  Plus,
  Search,
  SquareKanban,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { ToolCardContribution } from '@localixai/mini-app-sdk/ui'
import { StatusDot } from '@localixai/kit/status-dot'
import {
  ErrorRow,
  IORow,
  OutputBlock,
  ToolBody,
  ToolHeaderAction,
  ToolLine,
  hasItemError,
  isItemStreaming,
  itemErrorMessage,
} from '@localixai/kit/tool-card'

import type { KanbanAction } from '../../shared/tool'
import { kanbanStatusDot, kanbanStatusLabel } from '../model/kanbanStatus'
import { openBoard, openTask } from '../navigation'

/** The call the transcript renders — the host's own item shape, as its card seam declares it. */
type ToolCallItem = ComponentProps<NonNullable<ToolCardContribution['Component']>>['item']

/** Presentation for every action of the passive board tool. */
const ACTION = {
  list: { icon: SquareKanban, verb: 'Viewed board' },
  search: { icon: Search, verb: 'Searched board' },
  create: { icon: Plus, verb: 'Created' },
  update: { icon: SquareKanban, verb: 'Updated' },
  take: { icon: UserRound, verb: 'Took' },
  reorder: { icon: SquareKanban, verb: 'Reordered' },
  delete: { icon: SquareKanban, verb: 'Deleted' },
  detail: { icon: SquareKanban, verb: 'Opened' },
  complete: { icon: CheckCircle2, verb: 'Completed' },
  block: { icon: TriangleAlert, verb: 'Blocked' },
} satisfies Record<KanbanAction, { icon: LucideIcon; verb: string }>

/**
 * The slice of a card this reads. It PARSES a persisted, `unknown` tool result — one written by
 * whatever build ran the call — rather than trusting it to match today's `KanbanToolDetails`, so
 * every field is optional and `status` stays a bare string the status helpers narrow.
 */
interface TaskShape {
  id?: string
  title?: string
  status?: string
  kind?: string
  assignee?: string | null
  error?: string | null
  subtasks?: { done: boolean }[]
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined

/**
 * One call of the `kanban` tool in the transcript, linking to the cards it touched.
 *
 * Every link opens in the chat the call RAN in (`details.sessionId`), not the chat on screen: a
 * card id is only unique within its chat's board, so the same `LX-3` in another chat is a
 * different card. A result without a session has nothing to open, and shows no link.
 *
 * The card never opens the board itself: its header action is the person's way there, and the
 * agent links the board when it should be in front of them.
 */
export function KanbanCard({ item }: { item: ToolCallItem }) {
  const input = record(item.input)
  const details = record(item.output)
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)

  const sessionId = text(details.sessionId)

  const action = text(input.action) ?? 'update'
  const spec = (ACTION as Record<string, { icon: LucideIcon; verb: string }>)[action] ?? {
    icon: SquareKanban,
    verb: 'Board',
  }
  const task = details.task ? (record(details.task) as TaskShape) : undefined
  const tasks = Array.isArray(details.tasks) ? (details.tasks as TaskShape[]) : undefined

  // list and search both answer with a slice of the board.
  const isBoardList = action === 'list' || action === 'search'
  const isEpic = (task?.kind ?? input.kind) === 'epic'
  const taskTitle = task?.title ?? text(input.title) ?? ''
  const status = task?.status
  const subtaskDone = task?.subtasks?.filter((s) => s.done).length ?? 0
  const subtaskTotal = task?.subtasks?.length ?? 0

  const title = isBoardList
    ? 'Kanban board'
    : `${spec.verb}${isEpic ? ' epic' : ''}${taskTitle ? `: ${taskTitle}` : ''}`
  const subtitle = streaming
    ? '…'
    : hasError
      ? 'Failed'
      : isBoardList && tasks
        ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
        : status
          ? kanbanStatusLabel(status)
          : 'Done'
  const note = text(input.note)
  const open = (card: TaskShape) => {
    if (sessionId && card.id) openTask(sessionId, { id: card.id, title: card.title })
  }

  return (
    <ToolLine
      icon={spec.icon}
      title={title}
      titleDetails={taskTitle || undefined}
      subtitle={subtitle}
      isLoading={streaming}
      hasError={hasError}
      badge={
        status && !isBoardList ? (
          <span className="flex items-center gap-1 text-2xs font-medium text-text-soft">
            <StatusDot className={kanbanStatusDot(status)} /> {kanbanStatusLabel(status)}
          </span>
        ) : isEpic ? (
          <span className="flex items-center gap-1 text-2xs text-status-info">
            <Boxes className="size-2.5" /> epic
          </span>
        ) : undefined
      }
      headerActions={
        sessionId ? (
          <ToolHeaderAction
            icon={SquareKanban}
            label={task?.id ? `Open ${task.id}` : 'Open board'}
            onClick={() => (task?.id ? open(task) : openBoard(sessionId))}
          />
        ) : undefined
      }
    >
      <ToolBody>
        {tasks && tasks.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {tasks.slice(0, 12).map((t, i) => (
              <button
                key={t.id ?? i}
                type="button"
                disabled={!sessionId || !t.id}
                onClick={() => open(t)}
                className="flex items-center gap-2 rounded-sm px-1 py-0.5 text-left outline-none transition-colors hover:bg-surface-hover focus-ring disabled:hover:bg-transparent"
              >
                <StatusDot className={kanbanStatusDot(String(t.status))} />
                {t.kind === 'epic' && <Boxes className="size-2.5 shrink-0 text-status-info" />}
                <span className="min-w-0 flex-1 truncate text-2xs text-foreground">{t.title}</span>
                <span className="shrink-0 text-2xs text-text-faint">
                  {kanbanStatusLabel(String(t.status))}
                </span>
              </button>
            ))}
            {tasks.length > 12 && (
              <span className="px-1 text-2xs text-text-faint">+{tasks.length - 12} more</span>
            )}
          </div>
        )}
        {task && (task.assignee || subtaskTotal > 0 || isEpic) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {task.assignee && (
              <span className="inline-flex items-center gap-1 text-2xs font-medium text-text-soft">
                <UserRound className="size-2.5 text-text-faint" />@{task.assignee}
              </span>
            )}
            {subtaskTotal > 0 && (
              <span className="inline-flex items-center gap-1 text-2xs font-medium tabular-nums text-text-soft">
                <Check className="size-2.5 text-status-success" />
                {subtaskDone}/{subtaskTotal}
              </span>
            )}
            {isEpic && (
              <span className="inline-flex items-center gap-1 text-2xs font-medium text-status-info">
                <Boxes className="size-2.5" />
                epic
              </span>
            )}
          </div>
        )}
        {note && (
          <IORow label="NOTE">
            <OutputBlock>{note}</OutputBlock>
          </IORow>
        )}
        {task?.error && (
          <IORow label="WHY">
            <OutputBlock linkify>{task.error}</OutputBlock>
          </IORow>
        )}
        <ErrorRow message={itemErrorMessage(item)} />
      </ToolBody>
    </ToolLine>
  )
}
