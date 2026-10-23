import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { MessageSquareOff, TriangleAlert } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { DROP_TARGET_INDICATOR } from '@localixai/kit/drop-target'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

import type { KanbanStatus } from '../../shared/contracts'
import { useBoardTasks } from '../model/useBoard'
import { openTask } from '../navigation'
import { BoardColumns } from './board-columns'
import { BoardProgress } from './board-progress'
import { CreateTaskDialog } from './create-dialog'
import { SelectionBar } from './selection-bar'
import { KanbanStats } from './stats'
import { KanbanToolbar } from './toolbar'
import type { BoardView } from './types'
import { useBoardColumns } from './useBoardColumns'
import { useBoardCreate } from './useBoardCreate'
import { useBoardDensity } from './useBoardDensity'
import { useBoardKeyboardMove } from './useBoardKeyboardMove'
import { useBoardWrites } from './useBoardWrites'
import { useCardActions } from './useCardActions'
import { useCollapsedColumns } from './useCollapsedColumns'
import { useKanbanDrag } from './useKanbanDrag'
import { useKanbanFilters } from './useKanbanFilters'
import { useKanbanSelection } from './useKanbanSelection'
import { useScrollHints } from './useScrollHints'
import { boardSummary } from './utils'

/**
 * The board tab: the board of the chat this tab BELONGS to (`useWorkItemSessionId`), never the
 * active one — a board kept mounted in the background after the person switched chats must keep
 * showing and writing its own chat's cards. A board tab that belongs to no chat has no board.
 */
export function BoardTab() {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) {
    return (
      <StateNotice
        icon={MessageSquareOff}
        title="Open the board from a chat"
        body="Each chat has its own board, kept by you and the agent in that chat."
      />
    )
  }
  return <KanbanBoard key={sessionId} sessionId={sessionId} />
}

/** The composition root: data, filters, drag and selection state, assembled into one view. */
function KanbanBoard({ sessionId }: { sessionId: string }) {
  const board = useBoardTasks(sessionId)
  const { tasks } = board
  const [view, setView] = useState<BoardView>('board')
  const [statsNow, setStatsNow] = useState(0)
  const filters = useKanbanFilters(sessionId, tasks)
  const writes = useBoardWrites(sessionId, board)
  // Live mirror of the multi-selection so a drag can read it at grab time (the selection hook is
  // built below, after the drag hook needs a ref).
  const selectedIdsRef = useRef<Set<string>>(new Set())
  const drag = useKanbanDrag(sessionId, tasks, filters.visible, writes.applyMoves, selectedIdsRef)
  const [collapsedColumns, toggleColumn] = useCollapsedColumns()
  const [density] = useBoardDensity()
  const [fullCreateOpen, setFullCreateOpen] = useState(false)
  const quickCreate = useBoardCreate(sessionId)

  // Edge fades hinting the columns scroll horizontally — each only when there is more board that way.
  const { scrollRef, canScrollLeft, canScrollRight, syncScrollHint } = useScrollHints(
    view === 'board',
    tasks.length,
  )

  const columns = useBoardColumns(tasks, drag.leafTasks, drag.epicById, filters.visible)
  const { selected, selectCard, clear: clearSelection } = useKanbanSelection(columns.flatLeafIds)
  // The ids a confirmed delete would remove — one card (its context menu) or the whole selection
  // (the selection bar). One state, one dialog, so the two can never disagree about what goes.
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  useEffect(() => {
    selectedIdsRef.current = selected
  }, [selected])

  const runBatchMove = (to: KanbanStatus) => {
    void writes.batchMove([...selected], to)
    clearSelection()
  }
  const runDelete = () => {
    const ids = pendingDelete
    setPendingDelete(null)
    if (!ids || ids.length === 0) return
    void writes.batchDelete(ids)
    clearSelection()
  }

  const boardStats = useMemo(() => boardSummary(filters.visible), [filters.visible])
  const dropIndicator = <div className={cn('h-0.5 shrink-0 rounded-full', DROP_TARGET_INDICATOR)} />

  const open = useCallback(
    (taskId: string) => {
      // A plain open replaces any multi-selection, list-style.
      clearSelection()
      const task = tasks.find((candidate) => candidate.id === taskId)
      openTask(sessionId, task ?? { id: taskId })
    },
    [clearSelection, tasks, sessionId],
  )

  const handleColumnDragLeave = useCallback(
    (status: KanbanStatus, event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        drag.setDropTarget((prev) => (prev?.status === status ? null : prev))
      }
    },
    [drag],
  )

  const keyboardMove = useBoardKeyboardMove({
    quickMove: writes.quickMove,
    columnFill: (status) => columns.renderedByStatus.get(status),
    ensureColumnShows: columns.ensureColumnShows,
    renderedKey: columns.renderedByStatus,
    scrollRef,
  })

  // One frozen action object shared by EVERY card; see `useCardActions` and `card-actions.ts`.
  const cardActions = useCardActions(
    useMemo(
      () => ({
        open,
        quickMove: (taskId: string, to: KanbanStatus) => void writes.quickMove(taskId, to),
        keyboardMove,
        select: selectCard,
        dragStart: drag.onCardDragStart,
        dragEnd: drag.onCardDragEnd,
        requestDelete: (taskId: string) => setPendingDelete([taskId]),
      }),
      [open, writes, keyboardMove, selectCard, drag],
    ),
  )

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <KanbanToolbar
        view={view}
        onViewChange={(next) => {
          setView(next)
          if (next === 'stats') setStatsNow(Date.now())
        }}
        quickCreate={quickCreate}
        onOpenFullCreate={() => setFullCreateOpen(true)}
        filters={filters}
      />

      {fullCreateOpen && (
        <CreateTaskDialog
          sessionId={sessionId}
          open={fullCreateOpen}
          onClose={() => setFullCreateOpen(false)}
          tasks={tasks}
        />
      )}

      {view === 'stats' ? (
        <KanbanStats tasks={filters.statsScoped} now={statsNow} onOpen={open} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {board.error && (
            // Named once, with the way out: the stream carries changes only, so a board whose
            // read failed stays incomplete until it is read again.
            <WorkbenchNoticeBar
              role="alert"
              tone="error"
              icon={<TriangleAlert className="size-3.5" />}
              title="The board could not be read"
              description={board.error}
              actions={
                <Button size="sm" variant="secondary" onClick={() => void board.reconcile()}>
                  Try again
                </Button>
              }
            />
          )}
          <BoardProgress summary={boardStats} />
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={syncScrollHint}
              className="flex h-full gap-2 overflow-x-auto scrollbar-thin px-3 py-2"
            >
              <BoardColumns
                rendered={columns.renderedByStatus}
                childrenByEpic={columns.childrenByEpic}
                doneIds={columns.doneIds}
                collapsedColumns={collapsedColumns}
                toggleColumn={toggleColumn}
                compactCards={density === 'compact'}
                drag={drag}
                cardActions={cardActions}
                selected={selected}
                onOpenTask={open}
                onShowMore={columns.showMoreInColumn}
                onColumnDragLeave={handleColumnDragLeave}
                dropIndicator={dropIndicator}
                loading={board.loading}
                loadFailed={board.error !== null}
              />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent transition-opacity duration-(--dur-base)"
              style={{ opacity: canScrollLeft ? 1 : 0 }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent transition-opacity duration-(--dur-base)"
              style={{ opacity: canScrollRight ? 1 : 0 }}
            />
            {selected.size > 0 && (
              <SelectionBar
                count={selected.size}
                onSetReady={() => runBatchMove('ready')}
                onBlock={() => runBatchMove('blocked')}
                onDelete={() => setPendingDelete([...selected])}
                onClear={clearSelection}
              />
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.length ?? 0} task${pendingDelete?.length === 1 ? '' : 's'}?`}
        description={
          pendingDelete?.length === 1
            ? 'The task will be removed permanently. This can’t be undone.'
            : 'The selected tasks will be removed permanently. This can’t be undone.'
        }
        confirmLabel="Delete"
        onConfirm={runDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
