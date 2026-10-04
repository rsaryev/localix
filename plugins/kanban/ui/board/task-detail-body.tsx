import { memo } from 'react'
import { Boxes, Check } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { SectionLabel } from '@localixai/kit/section-label'
import { StatusDot } from '@localixai/kit/status-dot'

import type { KanbanSubtask, KanbanTask } from '../../shared/contracts'
import {
  KANBAN_STATUS_DOT as STATUS_DOT,
  KANBAN_STATUS_LABEL as STATUS_LABEL,
} from '../model/kanbanStatus'
import { ArtifactList } from './artifacts'
import { MdBody } from './markdown-body'

/**
 * Everything below the task header: the blocked banner, the description, artifacts, an epic's
 * tasks, and the checklist.
 *
 * Memoized because unrelated panel updates should not rebuild the Markdown, artifact and
 * checklist subtrees. Its props change only when the card itself does.
 */
export const TaskDetailBody = memo(function TaskDetailBody({
  detail,
  epicChildren,
  onOpenTask,
  onWriteSubtasks,
}: {
  detail: KanbanTask
  /** An epic's tasks, in creation order, read from the same board as the epic. */
  epicChildren: KanbanTask[]
  onOpenTask: (task: KanbanTask) => void
  /** Replace the checklist; the panel guards the write against a stale card. */
  onWriteSubtasks: (subtasks: KanbanSubtask[]) => void
}) {
  return (
    <div className="px-4 py-4">
      {detail.status === 'blocked' && detail.error && (
        <div className="mb-4 rounded-lg border border-status-error/30 bg-status-error/10 px-3.5 py-3">
          <SectionLabel weight="semibold" className="mb-1 text-status-error">
            Blocked
          </SectionLabel>
          <MdBody text={detail.error} className="[&_p]:text-status-error/90" />
        </div>
      )}

      <SectionLabel className="mb-2">Description</SectionLabel>
      {detail.description ? (
        <MdBody text={detail.description} />
      ) : (
        <p className="text-xs text-text-faint">No description.</p>
      )}

      {detail.artifacts.length > 0 && (
        <div className="mt-5 border-t border-border-soft pt-4">
          <SectionLabel className="mb-2.5">Artifacts · {detail.artifacts.length}</SectionLabel>
          <ArtifactList artifacts={detail.artifacts} />
        </div>
      )}
      {detail.kind === 'epic' && (
        <div className="mt-5 border-t border-border-soft pt-4">
          <SectionLabel className="mb-2.5 flex items-center gap-1.5">
            <Boxes className="size-3" />
            Related tasks · {epicChildren.filter((c) => c.status === 'done').length}/
            {epicChildren.length}
          </SectionLabel>
          {epicChildren.length === 0 ? (
            // A claim about the EPIC, safe to make: the epic and its tasks come from the same
            // read of the same board, so an epic on screen means its tasks were read too.
            <p className="text-xs text-text-faint">No tasks under this epic yet.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {epicChildren.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenTask(c)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-ring hover:bg-surface-hover"
                  title={`${c.id} ${c.title} — ${STATUS_LABEL[c.status]}`}
                >
                  <StatusDot size="md" className={STATUS_DOT[c.status]} />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm leading-6',
                      c.status === 'done' ? 'text-text-faint' : 'text-foreground',
                    )}
                  >
                    {c.title}
                  </span>
                  <span className="shrink-0 text-2xs text-text-faint">
                    {STATUS_LABEL[c.status]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {detail.subtasks.length > 0 && (
        <div className="mt-5 border-t border-border-soft pt-4">
          <SectionLabel className="mb-2.5 flex items-center gap-1.5">
            <Check className="size-3" /> Checklist ·{' '}
            {detail.subtasks.filter((st) => st.done).length}/{detail.subtasks.length}
          </SectionLabel>
          <div className="flex flex-col gap-1">
            {detail.subtasks.map((st) => (
              <button
                key={st.id}
                type="button"
                role="checkbox"
                aria-checked={st.done}
                aria-label={st.text}
                className="group/st flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-ring hover:bg-surface-hover"
                onClick={() =>
                  onWriteSubtasks(
                    detail.subtasks.map((x) => (x.id === st.id ? { ...x, done: !x.done } : x)),
                  )
                }
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                    st.done
                      ? 'border-status-success bg-status-success text-background'
                      : 'border-border group-hover/st:border-foreground/40',
                  )}
                >
                  {st.done && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span
                  className={cn(
                    'text-sm leading-6',
                    st.done ? 'text-text-faint line-through' : 'text-foreground',
                  )}
                >
                  {st.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
