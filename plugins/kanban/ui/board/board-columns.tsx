import type { DragEvent, ReactNode } from 'react'
import { Boxes, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  DROP_TARGET_SLOT,
  DROP_TARGET_SURFACE_ACTIVE,
  DROP_TARGET_TRANSITION,
} from '@localixai/kit/drop-target'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionLabel } from '@localixai/kit/section-label'
import { StatusDot } from '@localixai/kit/status-dot'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { KANBAN_STATUS_DOT as STATUS_DOT } from '../model/kanbanStatus'
import type { CardActions } from './card-actions'
import { EpicCard, TaskCard } from './cards'
import { ColumnMore } from './column-more'
import { ColumnSkeleton } from './column-skeleton'
import type { capColumn } from './columnCap'
import { COLUMNS, DROPPABLE } from './constants'
import type { KanbanDrag } from './useKanbanDrag'

/** One frozen empty list, so an epic with no children keeps a stable card prop. */
const EMPTY_TASKS: KanbanTask[] = []

/**
 * The board's lanes.
 *
 * Only the layout lives here — every value it draws from is computed and
 * identity-stabilized upstream (`useBoardColumns`, `useCardActions`), because the
 * board re-renders on every drag-over frame and the cards' `memo` boundaries are
 * what keep that from re-rendering the whole board. Passing the frozen
 * `cardActions` object straight through, rather than building closures here, is
 * part of that discipline.
 */
export function BoardColumns({
  rendered,
  childrenByEpic,
  doneIds,
  collapsedColumns,
  toggleColumn,
  compactCards,
  drag,
  cardActions,
  selected,
  onOpenTask,
  onShowMore,
  onColumnDragLeave,
  dropIndicator,
  loading,
  loadFailed,
}: {
  rendered: Map<KanbanStatus, ReturnType<typeof capColumn>>
  childrenByEpic: Map<string, KanbanTask[]>
  doneIds: Set<string>
  collapsedColumns: Set<KanbanStatus>
  toggleColumn: (status: KanbanStatus) => void
  compactCards: boolean
  drag: KanbanDrag
  cardActions: CardActions
  selected: Set<string>
  onOpenTask: (id: string) => void
  onShowMore: (status: KanbanStatus) => void
  onColumnDragLeave: (status: KanbanStatus, event: DragEvent<HTMLDivElement>) => void
  dropIndicator: ReactNode
  loading: boolean
  /** The last read failed; the board's notice says why. */
  loadFailed: boolean
}) {
  return (
    <>
      {COLUMNS.map(({ status, title }) => {
        const { epicCards, groups, loose, hidden, total: totalCount } = rendered.get(status)!
        const droppable = DROPPABLE.has(status) && drag.draggingId !== null
        const isDroppingHere = drag.dropTarget?.status === status && drag.draggingId !== null
        const looseDropping = isDroppingHere && drag.dropTarget!.epicId === null
        const isEmpty = totalCount === 0
        // A collapsed column shrinks to a slim, clickable rail that still
        // shows its count — the active lanes reclaim the freed width. It's
        // not a drop target (expand it to drop); collapsing is a deliberate
        // "not triaging this lane" gesture (usually Done / Cancelled).
        if (collapsedColumns.has(status)) {
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleColumn(status)}
              title={`Expand ${title}${totalCount > 0 ? ` (${totalCount})` : ''}`}
              aria-label={`Expand ${title} column`}
              // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than
              // the board, so a collapsed rail read as a black strip between the columns.
              className="flex w-8 shrink-0 flex-col items-center gap-2 rounded-lg border border-border-soft bg-foreground/[0.04] py-2 text-text-faint outline-none transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              <PanelLeftOpen className="size-3.5 shrink-0" />
              <StatusDot className={cn('shrink-0', STATUS_DOT[status])} />
              <span className="[writing-mode:vertical-rl] text-2xs font-semibold uppercase tracking-wide">
                {title}
              </span>
              {totalCount > 0 && <span className="text-2xs tabular-nums">{totalCount}</span>}
            </button>
          )
        }
        return (
          <div
            key={status}
            role="group"
            aria-label={`${title} column (${totalCount})`}
            // Faint foreground veil, not `bg-background`: the board pane already paints that
            // ground, and the once-only rule clears a nested coat — so under glass the column
            // trough silently vanished. A veil reads as a trough on every theme.
            className={cn(
              'flex min-w-44 flex-1 shrink-0 flex-col rounded-lg border bg-foreground/[0.03]',
              DROP_TARGET_TRANSITION,
              isDroppingHere ? DROP_TARGET_SURFACE_ACTIVE : 'border-border-soft',
              drag.draggingId && !DROPPABLE.has(status) ? 'opacity-50' : '',
            )}
          >
            <div className="group/col flex items-center justify-between px-2 py-1.5">
              <SectionLabel as="span" weight="semibold" className="flex items-center gap-1.5">
                <StatusDot className={STATUS_DOT[status]} /> {title}
              </SectionLabel>
              <div className="flex items-center gap-1">
                {totalCount > 0 && (
                  <span className="text-2xs tabular-nums text-text-faint">{totalCount}</span>
                )}
                {/* The kit's icon action, revealed on hover or focus like the host's own
                    row actions (`lx-hover-actions`). */}
                <IconButton
                  size="xs"
                  onClick={() => toggleColumn(status)}
                  tooltip={`Collapse ${title}`}
                  aria-label={`Collapse ${title} column`}
                  className="lx-hover-actions opacity-0 transition-opacity focus-visible:opacity-100 group-hover/col:opacity-100"
                >
                  <PanelLeftClose className="size-3" />
                </IconButton>
              </div>
            </div>
            <div
              className={cn(
                'flex min-h-16 flex-1 flex-col overflow-y-auto scrollbar-thin px-1.5 pb-1.5',
                compactCards ? 'gap-1' : 'gap-1.5',
              )}
              onDragOver={(event) => drag.onSectionDragOver(event, status, null)}
              onDragLeave={(event) => onColumnDragLeave(status, event)}
              onDrop={(event) => drag.onSectionDrop(event, status, null)}
            >
              {epicCards.map((epic) => (
                <div key={epic.id} data-task-card>
                  <EpicCard
                    epic={epic}
                    childTasks={childrenByEpic.get(epic.id) ?? EMPTY_TASKS}
                    dragging={drag.draggingIds.has(epic.id)}
                    actions={cardActions}
                  />
                </div>
              ))}

              {groups.map(({ epic, tasks: groupTasks }) => {
                const groupDropping = isDroppingHere && drag.dropTarget!.epicId === epic.id
                return (
                  <div
                    key={epic.id}
                    className={cn(
                      'flex flex-col gap-1 rounded-lg border border-status-info/25 bg-status-info/[0.04] p-1',
                      DROP_TARGET_TRANSITION,
                      groupDropping && DROP_TARGET_SURFACE_ACTIVE,
                      droppable && !groupDropping && 'border-dashed',
                    )}
                    onDragOver={(event) => drag.onSectionDragOver(event, status, epic.id)}
                    onDrop={(event) => drag.onSectionDrop(event, status, epic.id)}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenTask(epic.id)}
                      className="flex items-center gap-1 rounded-xs px-1 pt-0.5 text-left text-2xs font-medium text-status-info outline-none focus-ring hover:underline"
                      title={`Epic: ${epic.title}`}
                    >
                      <Boxes className="size-2.5 shrink-0" />
                      <span className="truncate">{epic.title}</span>
                    </button>
                    {groupTasks.map((task, index) => (
                      <div key={task.id} data-task-card className="flex flex-col gap-1">
                        {groupDropping && drag.dropTarget!.index === index && dropIndicator}
                        <TaskCard
                          task={task}
                          doneIds={doneIds}
                          compact
                          dragging={drag.draggingIds.has(task.id)}
                          selected={selected.has(task.id)}
                          actions={cardActions}
                        />
                      </div>
                    ))}
                    {groupDropping && drag.dropTarget!.index >= groupTasks.length && dropIndicator}
                  </div>
                )
              })}

              {loose.map((task, index) => (
                <div
                  key={task.id}
                  data-task-card
                  className={cn('flex flex-col', compactCards ? 'gap-1' : 'gap-1.5')}
                >
                  {looseDropping && drag.dropTarget!.index === index && dropIndicator}
                  <TaskCard
                    task={task}
                    doneIds={doneIds}
                    compact={compactCards}
                    dragging={drag.draggingIds.has(task.id)}
                    selected={selected.has(task.id)}
                    actions={cardActions}
                  />
                </div>
              ))}
              {looseDropping && drag.dropTarget!.index >= loose.length && dropIndicator}
              {hidden > 0 && (
                <ColumnMore
                  hidden={hidden}
                  columnTitle={title}
                  onShowMore={() => onShowMore(status)}
                />
              )}
              {isEmpty && droppable && (
                <div
                  className={cn(
                    'm-auto rounded-md border border-dashed px-3 py-2 text-2xs',
                    DROP_TARGET_TRANSITION,
                    isDroppingHere ? DROP_TARGET_SLOT : 'border-border-soft text-text-faint',
                  )}
                >
                  Drop here
                </div>
              )}
              {isEmpty &&
                !droppable &&
                // Three states, not two. An empty column mid-fetch is not an empty column:
                // `tasks` starts `[]` with no error, so every lane used to read "No tasks" for
                // the whole first round-trip and then pop. Only claim emptiness once the read
                // settled — a failed read is empty for a reason the board's notice names once,
                // rather than every lane repeating it.
                (loading ? (
                  <ColumnSkeleton compact={compactCards} />
                ) : (
                  <div className="m-auto select-none text-2xs text-text-faint">
                    {loadFailed ? 'Not loaded' : 'No tasks'}
                  </div>
                ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
