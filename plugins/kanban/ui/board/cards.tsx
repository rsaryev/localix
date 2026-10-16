import { memo } from 'react'
import { Boxes, Link2, Paperclip } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { StatusDot } from '@localixai/kit/status-dot'

import type { KanbanTask } from '../../shared/contracts'
import { KANBAN_STATUS_DOT as STATUS_DOT } from '../model/kanbanStatus'
import {
  PRIORITY_PRESENTATION,
  priorityBucket,
  signedPriority,
} from '../model/priorityPresentation'
import type { CardActions } from './card-actions'
import { CardContextMenu } from './card-context-menu'
import { LabelChips } from './label-chips'
import { OriginChip } from './origin-chip'
import { quickAction, subtaskProgress } from './utils'

/** The done/total progress bar shared by a task card (subtasks) and an epic card
 *  (child tasks) — one source of truth for the bar + count + a11y labelling so the
 *  two never drift. `noun` names what is counted for the title/aria text. */
function CardProgress({ done, total, noun }: { done: number; total: number; noun: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5" title={`${done}/${total} ${noun} done`}>
      <ProgressBar
        value={total ? (done / total) * 100 : 0}
        className="h-1 flex-1"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${done} of ${total} ${noun} done`}
      />
      <span className="text-2xs tabular-nums text-text-faint">
        {done}/{total}
      </span>
    </div>
  )
}

/** A non-zero priority: the shared glyph in its tone, then the signed value (the bucket alone
 *  would hide +2 behind +1). */
function PriorityChip({ priority }: { priority: number }) {
  const { label, icon: Icon } = PRIORITY_PRESENTATION[priorityBucket(priority)]
  const value = signedPriority(priority)
  return (
    <span
      className="flex items-center gap-0.5 font-medium tabular-nums text-text-faint"
      title={`Priority: ${label} (${value})`}
    >
      <Icon className="size-2.5" aria-hidden="true" />
      {value}
    </span>
  )
}

/** Compact chips for the pipeline fields (priority / dependencies / attachments).
 *  `doneIds` is the set of task ids in the `done` column — an O(1) lookup so a
 *  card with N dependencies costs O(N), not O(N × total-tasks) per render. */
export function PipelineChips({ task, doneIds }: { task: KanbanTask; doneIds: Set<string> }) {
  const unmet = task.dependsOn.filter((id) => !doneIds.has(id)).length
  return (
    <>
      {task.priority !== 0 && <PriorityChip priority={task.priority} />}
      {task.dependsOn.length > 0 && (
        <span
          className={cn(
            'flex items-center gap-0.5 tabular-nums',
            unmet > 0 && task.status === 'ready' ? 'text-status-warning' : 'text-text-faint',
          )}
          title={
            unmet > 0
              ? `Waiting on ${unmet} of ${task.dependsOn.length} dependencies`
              : `All ${task.dependsOn.length} dependencies done`
          }
        >
          <Link2 className="size-2.5" /> {task.dependsOn.length - unmet}/{task.dependsOn.length}
        </span>
      )}
      {task.attachedPaths.length > 0 && (
        <span
          className="flex items-center gap-0.5 tabular-nums text-text-faint"
          title={`${task.attachedPaths.length} attached file(s):\n${task.attachedPaths.join('\n')}`}
        >
          <Paperclip className="size-2.5" /> {task.attachedPaths.length}
        </span>
      )}
    </>
  )
}

export interface TaskCardProps {
  task: KanbanTask
  /** Ids of tasks in the `done` column — for the dependency chip's met/unmet count.
   *  MUST be referentially stable while its contents are unchanged, or `memo` below
   *  re-renders every card on every board frame (see `useStableIdSet`). */
  doneIds: Set<string>
  /** Inside an epic group — tighter padding. */
  compact?: boolean
  dragging: boolean
  /** Part of the current multi-selection — draws the selected ring. */
  selected?: boolean
  actions: CardActions
}

function TaskCardImpl({ task, doneIds, compact, dragging, selected, actions }: TaskCardProps) {
  const { done, total } = subtaskProgress(task)
  const quick = quickAction(task)
  return (
    // The menu lives INSIDE the memo boundary on purpose: wrapping <TaskCard> from
    // the board would hand the wrapper a fresh `children` element every board frame,
    // re-rendering a Radix root per card per frame and giving back what memo saved.
    <CardContextMenu task={task} actions={actions}>
      <div
        draggable
        role="button"
        tabIndex={0}
        data-task-id={task.id}
        aria-label={`Open task: ${task.title}`}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        aria-pressed={selected}
        onDragStart={(e) => actions.dragStart(e, task)}
        onDragEnd={actions.dragEnd}
        onClick={(e) => {
          // ⌘/Ctrl or Shift click drives multi-select instead of opening the card.
          if (isPrimaryModifier(e) || e.shiftKey) {
            e.preventDefault()
            actions.select(task.id, e.shiftKey ? { range: true } : { toggle: true })
            return
          }
          actions.open(task.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            actions.open(task.id)
            return
          }
          if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault()
            actions.keyboardMove(task, e.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
        // `--card`, not `bg-surface-raised`: raised mixes from a DARKER ground than the board, so
        // every card read as a black tile; `--card` is the element-sized LIFT token, which is what
        // a card on a column trough is.
        className={cn(
          'group relative cursor-grab select-none rounded-md border bg-card transition-[opacity,border-color,box-shadow]',
          'hover:border-border-strong hover:shadow-(--shadow-raised) active:cursor-grabbing',
          'outline-none focus-ring',
          selected
            ? 'border-status-info/70 ring-1 ring-status-info/45 bg-status-info/5'
            : 'border-border',
          compact ? 'p-1.5' : 'p-2',
          dragging && 'opacity-40',
        )}
      >
        {quick && (
          <button
            type="button"
            title={quick.label}
            aria-label={`${quick.label}: ${task.title}`}
            draggable={false}
            onClick={(e) => {
              e.stopPropagation()
              actions.quickMove(task.id, quick.to)
            }}
            className={cn(
              // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than
              // the card, so this hover action read as a black chip pinned to the corner.
              'absolute right-1 top-1 z-(--z-raised) flex items-center gap-0.5 rounded-sm border border-control-border/60 bg-foreground/[0.06] px-1 py-0.5 text-2xs font-medium text-text-faint backdrop-blur-sm',
              'lx-hover-actions opacity-0 transition-opacity hover:border-status-info/60 hover:text-status-info focus-visible:opacity-100 group-hover:opacity-100',
              'outline-none focus-ring',
            )}
          >
            <quick.Icon className="size-2.5" /> {quick.label}
          </button>
        )}
        <div className="flex items-start gap-1.5">
          <StatusDot className={cn('mt-1', STATUS_DOT[task.status])} />
          <span className="min-w-0 break-words text-xs font-medium text-foreground">
            <span className="mr-1 font-mono text-2xs text-text-faint">{task.id}</span>
            {task.title}
          </span>
        </div>
        {task.error && task.status === 'blocked' && (
          <p className="mt-1 line-clamp-2 text-2xs text-status-error" title={task.error}>
            {task.error}
          </p>
        )}
        {total > 0 && <CardProgress done={done} total={total} noun="subtasks" />}
        <LabelChips labels={task.labels} className="mt-1.5" />
        <div className="mt-1.5 flex items-center gap-1.5 text-2xs text-text-faint">
          <OriginChip origin={task.origin} showLabel={false} />
          {task.assignee && (
            <span className="truncate" title={`Assigned to @${task.assignee}`}>
              → @{task.assignee}
            </span>
          )}
          <PipelineChips task={task} doneIds={doneIds} />
          <div className="flex-1" />
        </div>
      </div>
    </CardContextMenu>
  )
}

/**
 * The board's task card.
 *
 * `memo` is load-bearing, not a micro-optimisation: the board component re-renders
 * on every drag-over frame (`dropTarget` churn) and on every board stream frame,
 * and without this every card in every column re-rendered each time. It only works
 * because the card's props are referentially stable — one frozen `CardActions`
 * object, a content-stable `doneIds`, and task objects the reducer preserves by
 * identity when they did not change. Breaking any of those silently un-does it;
 * `cards.memo.test.tsx` guards it.
 */
export const TaskCard = memo(TaskCardImpl)
TaskCard.displayName = 'TaskCard'

/** The epic's OWN card — rendered in the epic's status column. */
function EpicCardImpl({
  epic,
  childTasks,
  dragging,
  actions,
}: {
  epic: KanbanTask
  childTasks: KanbanTask[]
  dragging: boolean
  actions: CardActions
}) {
  const done = childTasks.filter((c) => c.status === 'done').length
  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      aria-label={`Open epic: ${epic.title}`}
      onDragStart={(e) => actions.dragStart(e, epic)}
      onDragEnd={actions.dragEnd}
      onClick={() => actions.open(epic.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          actions.open(epic.id)
        }
      }}
      className={cn(
        'group cursor-grab select-none rounded-md border border-status-info/35 bg-status-info/5 p-2 transition-[opacity,border-color]',
        'hover:border-status-info/60 active:cursor-grabbing',
        'outline-none focus-ring',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1.5">
        <Boxes className="mt-0.5 size-3 shrink-0 text-status-info" />
        <span className="min-w-0 break-words text-xs font-semibold text-foreground">
          <span className="mr-1 font-mono text-2xs font-normal text-text-faint">{epic.id}</span>
          {epic.title}
        </span>
      </div>
      <CardProgress done={done} total={childTasks.length} noun="tasks" />
    </div>
  )
}

export const EpicCard = memo(EpicCardImpl)
EpicCard.displayName = 'EpicCard'
