import { useCallback, useMemo, useState } from 'react'
import { MessageSquareOff, SquareKanban } from 'lucide-react'
import { toast, type WorkItemLike } from '@localixai/mini-app-sdk/ui'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'

import type { KanbanStatus, KanbanTask, UpdateKanbanTaskRequest } from '../../shared/contracts'
import { boardApi } from '../api/board-client'
import { acceptTask, setBoardTasks, type BoardState } from '../model/boardStore'
import {
  useBoardChildren,
  useBoardDoneIds,
  useBoardLabels,
  useBoardSlice,
  useBoardTask,
  useBoardTasksByIds,
} from '../model/useBoard'
import { openBoard, openTask, taskItemId } from '../navigation'
import { TaskDetailBody } from './task-detail-body'
import { TaskDetailHeader } from './TaskDetailHeader'

/** One frozen empty list, so a card with no dependencies keeps a stable selector key. */
const EMPTY_IDS: string[] = []
const selectSettled = (state: BoardState) => state.settled
const selectError = (state: BoardState) => state.error

/**
 * One card opened on its own, beside its board. The tab belongs to one chat for its whole life
 * (`useWorkItemSessionId`) and names the card in its payload; a card id is only unique within its
 * chat's board, so without both there is nothing to show.
 */
export function TaskTab({ item }: { item: WorkItemLike }) {
  const sessionId = useWorkItemSessionId()
  const taskId = typeof item.payload?.taskId === 'string' ? item.payload.taskId : null
  if (!sessionId || !taskId) {
    return (
      <StateNotice
        icon={MessageSquareOff}
        title="Open the card from its board"
        body="A card belongs to the board of the chat it was created in."
      />
    )
  }
  return <TaskDetailPanel key={`${sessionId}/${taskId}`} sessionId={sessionId} taskId={taskId} />
}

/**
 * The card reads from the chat's live board mirror, not from a fetch of its own: the mirror is
 * already kept true by the board's stream, so an edit made on the board, by the agent, or in
 * another window reaches this tab the moment it lands — and a card deleted anywhere shows as gone
 * instead of lingering as the last copy this tab happened to fetch. Every panel reads SLICES
 * (the card, its epic, its children, its dependencies), so a frame about another card re-renders
 * nothing here.
 */
function TaskDetailPanel({ sessionId, taskId }: { sessionId: string; taskId: string }) {
  const detail = useBoardTask(sessionId, taskId)
  const settled = useBoardSlice(sessionId, selectSettled)
  const boardError = useBoardSlice(sessionId, selectError)
  const parent = useBoardTask(sessionId, detail?.parentTaskId)
  const epicChildren = useBoardChildren(sessionId, detail?.kind === 'epic' ? detail.id : null)
  const children = useMemo(
    () => [...epicChildren].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [epicChildren],
  )
  const deps = useBoardTasksByIds(sessionId, detail?.dependsOn ?? EMPTY_IDS)
  const doneIds = useBoardDoneIds(sessionId, detail?.dependsOn ?? EMPTY_IDS)
  // Every label already in use, so the editor offers them instead of letting a vocabulary
  // fragment into near-duplicates.
  const labelSuggestions = useBoardLabels(sessionId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { copied: refCopied, copy } = useCopied(1200)

  /**
   * One write path for the panel. A whole-array field (labels, checklist, attachments) is
   * replaced wholesale, so it carries the `updatedAt` the panel last saw: a write computed from a
   * card someone else has since changed is refused as stale instead of erasing their change.
   */
  const updatedAt = detail?.updatedAt
  const write = useCallback(
    async (patch: UpdateKanbanTaskRequest, failure: string, guarded = false) => {
      try {
        const next = await boardApi.update(sessionId, taskId, {
          ...patch,
          ...(guarded && updatedAt ? { expectedUpdatedAt: updatedAt } : {}),
        })
        acceptTask(sessionId, next)
      } catch (error) {
        toast.error(failure, { description: errorMessage(error, '') || undefined })
      }
    },
    [sessionId, taskId, updatedAt],
  )

  const labels = detail?.labels
  const attachedPaths = detail?.attachedPaths
  const onSetStatus = useCallback(
    (status: KanbanStatus) => void write({ status }, 'Could not update this task'),
    [write],
  )
  const onAddLabel = useCallback(
    (label: string) => {
      if (!labels || labels.includes(label)) return
      void write({ labels: [...labels, label] }, 'Could not update the labels', true)
    },
    [labels, write],
  )
  const onRemoveLabel = useCallback(
    (label: string) => {
      if (!labels) return
      void write({ labels: labels.filter((l) => l !== label) }, 'Could not update the labels', true)
    },
    [labels, write],
  )
  const onRemoveAttached = useCallback(
    (path: string) => {
      if (!attachedPaths) return
      void write(
        { attachedPaths: attachedPaths.filter((p) => p !== path) },
        'Could not remove the attachment',
        true,
      )
    },
    [attachedPaths, write],
  )
  const onWriteSubtasks = useCallback(
    (subtasks: NonNullable<UpdateKanbanTaskRequest['subtasks']>) =>
      void write({ subtasks }, 'Could not update the checklist', true),
    [write],
  )
  const onOpenTask = useCallback((task: KanbanTask) => openTask(sessionId, task), [sessionId])
  const onOpenFile = useCallback(
    (path: string) => miniAppWorkspace.openFile({ sessionId, path }),
    [sessionId],
  )
  const onCopyRef = useCallback(() => void copy(taskId), [copy, taskId])
  const askDelete = useCallback(() => setConfirmDelete(true), [])

  const remove = async () => {
    setConfirmDelete(false)
    try {
      await boardApi.remove(sessionId, taskId)
      setBoardTasks(sessionId, (prev) => prev.filter((task) => task.id !== taskId))
      // The person deleted the card from its own tab, so the tab goes with it. A card deleted
      // elsewhere keeps the notice below: a tab must not vanish under someone reading it.
      miniAppWorkspace.closeWorkItems(taskItemId(taskId), { session: sessionId })
    } catch (error) {
      toast.error('Could not delete this task', {
        description: errorMessage(error, '') || undefined,
      })
    }
  }

  if (!detail) {
    if (!settled) return <LoadingHint className="min-h-0 flex-1 text-xs" />
    // A failed read is named, not spun on — and a card the board no longer has says so, rather
    // than a tab that quietly shows its last copy of a deleted card.
    const actions = (
      <Button size="sm" variant="secondary" onClick={() => openBoard(sessionId)}>
        <SquareKanban /> Open board
      </Button>
    )
    return boardError ? (
      <StateNotice title="The board could not be read" body={boardError} actions={actions} />
    ) : (
      <StateNotice
        title={`${taskId} is no longer on the board`}
        body="It was deleted from this chat’s board."
        actions={actions}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <TaskDetailHeader
          detail={detail}
          parent={parent}
          doneIds={doneIds}
          deps={deps}
          refCopied={refCopied}
          onCopyRef={onCopyRef}
          onOpenTask={onOpenTask}
          onOpenFile={onOpenFile}
          onSetStatus={onSetStatus}
          onDelete={askDelete}
          onRemoveAttached={onRemoveAttached}
          onAddLabel={onAddLabel}
          onRemoveLabel={onRemoveLabel}
          labelSuggestions={labelSuggestions}
        />
        <TaskDetailBody
          detail={detail}
          epicChildren={children}
          onOpenTask={onOpenTask}
          onWriteSubtasks={onWriteSubtasks}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this task?"
        description={`“${detail.title}” will be removed permanently. This can’t be undone.`}
        confirmLabel="Delete"
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
