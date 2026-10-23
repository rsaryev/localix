import { memo, useMemo } from 'react'
import { CheckCircle2, SquareKanban } from 'lucide-react'
import type { SessionSurfaceProps } from '@localixai/mini-app-sdk/ui'
import { CollapsibleStrip } from '@localixai/kit/collapsible-strip'
import { IconButton } from '@localixai/kit/icon-button'
import { StatusDot } from '@localixai/kit/status-dot'
import {
  WorkbenchListRow,
  WorkbenchListRowMeta,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'

import { KANBAN_STATUS_DOT, KANBAN_STATUS_LABEL } from '../model/kanbanStatus'
import { useBoardTasks } from '../model/useBoard'
import { openBoard, openTask } from '../navigation'

/** What `composer.header` hands along: whether this composer is the focused, warm one. */
const isFocusedComposer = (context: unknown): boolean =>
  typeof context === 'object' &&
  context !== null &&
  (context as { isFocused?: unknown }).isFocused === true

const RING = 2 * Math.PI * 7

/**
 * The chat's board above its composer: a progress ring, the card that is moving now, and — on
 * expand — every task with its status.
 *
 * Only the FOCUSED composer mounts it. Each mounted strip holds a board read and a stream
 * subscription, and a split layout keeps several composers warm; a strip per background composer
 * would watch boards nobody is looking at. Returning to a composer re-reads, painting from cache.
 *
 * It stays collapsed until the person opens it: auto-expanding on running work made it dominate
 * the composer.
 */
export function BoardStrip({ sessionId, context }: SessionSurfaceProps) {
  if (!sessionId || !isFocusedComposer(context)) return null
  return <BoardStripBody sessionId={sessionId} />
}

/** Memoized: typing in the composer re-renders the header, and nothing here depends on it. */
const BoardStripBody = memo(function BoardStripBody({ sessionId }: { sessionId: string }) {
  const { tasks: all } = useBoardTasks(sessionId)
  const tasks = useMemo(
    () =>
      all.filter((t) => t.kind === 'task').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [all],
  )

  const total = tasks.length
  if (total === 0) return null
  const done = tasks.filter((t) => t.status === 'done').length
  const active =
    tasks.find((t) => t.status === 'in_progress') ??
    tasks.find((t) => t.status === 'blocked') ??
    tasks.find((t) => t.status === 'ready')
  const progress = done / total

  return (
    <CollapsibleStrip
      label={{ expand: 'Show board tasks', collapse: 'Hide board tasks' }}
      icon={
        done === total ? (
          <CheckCircle2 className="size-4.5 text-status-success" />
        ) : (
          <svg viewBox="0 0 18 18" className="size-4.5 -rotate-90" aria-hidden>
            <circle
              cx="9"
              cy="9"
              r="7"
              fill="none"
              strokeWidth="2"
              className="stroke-surface-active"
            />
            <circle
              cx="9"
              cy="9"
              r="7"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${RING}`}
              strokeDashoffset={`${RING * (1 - progress)}`}
              className="stroke-text-strong transition-[stroke-dashoffset] duration-(--dur-slow) ease-(--ease-soft)"
            />
          </svg>
        )
      }
      count={`${done}/${total}`}
      title="Tasks"
      listLabel="Board tasks"
      summary={active ? `${active.title} · ${KANBAN_STATUS_LABEL[active.status]}` : undefined}
      actionsLabel="Task strip actions"
      actions={
        <IconButton
          size="md"
          aria-label="Open board"
          tooltip="Open board"
          tooltipSide="top"
          onClick={() => openBoard(sessionId)}
          className="hover:bg-surface-active hover:text-foreground"
        >
          <SquareKanban className="size-3.5" />
        </IconButton>
      }
    >
      {tasks.map((t) => (
        <WorkbenchListRow
          key={t.id}
          role="listitem"
          density="dense"
          className={t.status === 'done' || t.status === 'cancelled' ? 'opacity-70' : ''}
        >
          <StatusDot
            className={KANBAN_STATUS_DOT[t.status]}
            label={KANBAN_STATUS_LABEL[t.status]}
          />
          <WorkbenchListRowTrigger
            onClick={() => openTask(sessionId, t)}
            aria-label={`${t.title} — ${KANBAN_STATUS_LABEL[t.status]}${t.error ? `: ${t.error}` : ''}`}
            className="px-0"
          >
            <span
              className={
                t.status === 'done'
                  ? 'min-w-0 flex-1 truncate text-xs leading-tight line-through'
                  : 'min-w-0 flex-1 truncate text-xs leading-tight text-foreground'
              }
            >
              {t.title}
            </span>
          </WorkbenchListRowTrigger>
          {t.assignee && <WorkbenchListRowMeta>@{t.assignee}</WorkbenchListRowMeta>}
        </WorkbenchListRow>
      ))}
    </CollapsibleStrip>
  )
})
