import { memo } from 'react'
import { Boxes, Copy, Paperclip, Trash2, UserRound, X } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { StatusDot } from '@localixai/kit/status-dot'
import { TextAction } from '@localixai/kit/text-action'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { assigneeLabel, isHumanCard } from '../../shared/rules'
import {
  KANBAN_STATUS_DOT as STATUS_DOT,
  KANBAN_STATUS_LABEL as STATUS_LABEL,
} from '../model/kanbanStatus'
import { PipelineChips } from './cards'
import { LabelChips } from './label-chips'
import { LabelEditor } from './label-editor'
import { OriginChip } from './origin-chip'
import { userMoveTargets } from './utils'

/** The chip every dependency and attachment wears. Foreground veil, not `bg-surface-raised`:
 *  raised mixes from a darker ground than the panel, so a row of chips read as black pills. */
const CHIP =
  'flex items-center gap-1 rounded-sm border border-control-border/60 bg-foreground/[0.04] px-1.5 py-0.5'

/**
 * The task panel header: the reference and title, the status/origin/owner chip row, dependency
 * and attachment chips, and the status actions. Pure presentation: every value and handler comes
 * from the panel, which keeps them stable so an unrelated update does not rebuild this subtree.
 */
export const TaskDetailHeader = memo(function TaskDetailHeader({
  detail,
  parent,
  doneIds,
  deps,
  refCopied,
  onCopyRef,
  onOpenTask,
  onOpenFile,
  onSetStatus,
  onDelete,
  onRemoveAttached,
  onAddLabel,
  onRemoveLabel,
  labelSuggestions,
}: {
  detail: KanbanTask
  parent: KanbanTask | undefined
  doneIds: Set<string>
  /** The cards this one depends on — just those, not the whole board. */
  deps: KanbanTask[]
  refCopied: boolean
  onCopyRef: () => void
  onOpenTask: (task: KanbanTask) => void
  onOpenFile: (path: string) => void
  onSetStatus: (status: KanbanStatus) => void
  onDelete: () => void
  onRemoveAttached: (path: string) => void
  onAddLabel: (label: string) => void
  onRemoveLabel: (label: string) => void
  /** Labels already in use on the board, most used first. */
  labelSuggestions: readonly string[]
}) {
  const blocked = detail.status === 'blocked'
  return (
    <div className="space-y-2.5 border-b border-border-soft px-4 pb-3.5 pt-3.5">
      <div className="flex items-start gap-2 text-sm font-medium leading-snug">
        {detail.kind === 'epic' && <Boxes className="mt-0.5 size-4 shrink-0 text-status-info" />}
        <span className="min-w-0">
          {/* The reference, not a link: `LX-3` is what the agent and the board both answer to. */}
          <button
            type="button"
            title={refCopied ? 'Copied!' : 'Copy the task reference'}
            onClick={onCopyRef}
            className={cn(
              'mr-1.5 inline-flex items-center gap-1 rounded-xs font-mono text-2xs outline-none transition-colors focus-ring',
              refCopied ? 'text-status-success' : 'text-text-faint hover:text-status-info',
            )}
          >
            <Copy className="size-3" />
            {detail.id}
          </button>
          {detail.title}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-faint">
        <span className="flex items-center gap-1.5 rounded-sm bg-foreground/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-foreground">
          <StatusDot size="sm" className={STATUS_DOT[detail.status]} />{' '}
          {STATUS_LABEL[detail.status]}
        </span>
        {detail.kind === 'epic' && (
          <span className="rounded-sm bg-status-info/15 px-1.5 py-0.5 font-medium uppercase text-status-info">
            epic
          </span>
        )}
        {parent && (
          <button
            type="button"
            onClick={() => onOpenTask(parent)}
            title={`Open epic: ${parent.title}`}
            className="flex items-center gap-1 rounded-sm px-1 outline-none transition-colors focus-ring hover:text-foreground"
          >
            <Boxes className="size-3" /> <span className="max-w-32 truncate">{parent.title}</span>
          </button>
        )}
        <OriginChip origin={detail.origin} />
        {assigneeLabel(detail) && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-foreground/5 px-1.5 py-0.5">
            {isHumanCard(detail) && <UserRound className="size-3" aria-hidden />}
            {assigneeLabel(detail)}
          </span>
        )}
        <PipelineChips task={detail} doneIds={doneIds} />
        <LabelChips labels={detail.labels} onRemove={onRemoveLabel} />
        <LabelEditor labels={detail.labels} suggestions={labelSuggestions} onAdd={onAddLabel} />
      </div>

      {detail.dependsOn.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-faint">
          <span className="font-medium uppercase tracking-wider">Depends on</span>
          {detail.dependsOn.map((id) => {
            const dep = deps.find((t) => t.id === id)
            const dot = (
              <StatusDot className={dep ? STATUS_DOT[dep.status] : STATUS_DOT.cancelled} />
            )
            return dep ? (
              <button
                key={id}
                type="button"
                onClick={() => onOpenTask(dep)}
                title={`Open ${dep.id} “${dep.title}”`}
                className={cn(
                  CHIP,
                  'outline-none transition-colors focus-ring hover:border-foreground/40 hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {dot}
                <span className="max-w-36 truncate">{dep.title}</span>
              </button>
            ) : (
              <span key={id} className={CHIP}>
                {dot}
                <span className="max-w-36 truncate">{`${id} (not on the board)`}</span>
              </span>
            )
          })}
        </div>
      )}

      {detail.attachedPaths.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-faint">
          <span className="flex items-center gap-1 font-medium uppercase tracking-wider">
            <Paperclip className="size-3" /> Attached
          </span>
          {detail.attachedPaths.map((p) => (
            <span key={p} className={cn(CHIP, 'group/att inline-flex max-w-64 font-mono')}>
              <TextAction
                onClick={() => onOpenFile(p)}
                tooltip={`Open ${p}`}
                className="truncate hover:text-foreground"
              >
                {p}
              </TextAction>
              {/* A bare glyph button: the chip is a text-height inline element, and the smallest
                  IconButton would make it a control-height row. It still owns a name and a focus
                  edge, and surfaces on keyboard focus, not only on hover. */}
              <button
                type="button"
                onClick={() => onRemoveAttached(p)}
                title="Remove attachment"
                aria-label={`Remove ${p}`}
                className="lx-hover-actions shrink-0 rounded-xs text-text-faint opacity-0 outline-none transition-[opacity,color] focus-ring hover:text-status-error focus-visible:opacity-100 group-hover/att:opacity-100"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {/* The moves the rules allow a person from here — the same answer the board's menu gives. */}
        {userMoveTargets(detail).map((s) => (
          <Button
            key={s}
            variant={s === 'ready' && blocked ? 'default' : 'secondary'}
            size="sm"
            onClick={() => onSetStatus(s)}
          >
            {s === 'ready' ? 'Ready' : `Move to ${STATUS_LABEL[s].toLowerCase()}`}
          </Button>
        ))}
        {/* `ml-auto`, not a `flex-1` spacer: in a WRAPPING row a flex-1 item eats the whole
            remaining line, so Delete landed alone on a row of its own once the buttons wrapped. */}
        <Button
          variant="destructive"
          size="icon-sm"
          className="ml-auto"
          aria-label="Delete task"
          title="Delete task"
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
})
