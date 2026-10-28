import { useState } from 'react'
import {
  Check,
  Clock3,
  CornerDownRight,
  Hourglass,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  SendHorizontal,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { IconButton } from '@localixai/kit/icon-button'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
} from '@localixai/kit/workbench-list-row'
import { queueDeliveryLabel, queueItemCapabilities } from '@localixai/api/queue-presentation'
import type { SessionQueueItem, WakeSource } from '@/shared/api/contracts'
import { WAKE_SOURCE_META } from './wakeSourceMeta'

/** One row in the backend-owned composer queue. */
export interface QueuePanelItem {
  id: string
  text: string
  /** Backend queue kind; internal wakes cannot be promoted as user input. */
  queueKind?: SessionQueueItem['kind']
  /** Backend items only: provenance of the queued wake (loop / mini app / …). */
  wakeSource?: WakeSource
  /** Backend delivery boundary; next-tool is live steering, held a report awaiting siblings. */
  delivery?: SessionQueueItem['delivery']
  /** An agent's queued turn: shown as who answers, not as the runtime's ticket text. */
  agent?: { name: string }
  /** Why a `failed` item's delivery failed every retry; it waits for retry or removal. */
  failure?: string
}

/** What the row IS, in one 16px column: a face for an agent, a glyph for the rest. */
export function QueueItemGlyph({ item }: { item: QueuePanelItem }) {
  if (item.agent)
    return <MonogramAvatar identity={item.agent.name} label={item.agent.name} size={16} />
  const source = item.wakeSource ? WAKE_SOURCE_META[item.wakeSource] : undefined
  // A wake with no recorded source is still the runtime's, never a message of the person's.
  const Icon = source?.Icon ?? (item.queueKind === 'wake' ? Clock3 : MessageSquareText)
  return <Icon className="size-3.5 text-text-faint" aria-label={source?.label} />
}

export function QueueItemRow({
  item,
  index,
  onRemove,
  onSendNow,
  busy,
  pendingAction,
  feedback,
}: {
  item: QueuePanelItem
  index: number
  onRemove: () => void
  onSendNow?: () => void
  busy: boolean
  pendingAction?: 'send' | 'remove'
  feedback?: string
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deletesInternalWake = item.queueKind === 'wake'
  // An agent's turn is cancelled in one click: it holds no text of anyone's to lose, and
  // the chip strip above shows who is still in line. Other wakes (loops, mini apps) confirm.
  const confirmsDelete = deletesInternalWake && !item.agent
  const capabilities = item.queueKind ? queueItemCapabilities(item.queueKind) : null
  const removeLabel = item.agent
    ? `Cancel ${item.agent.name}'s queued turn`
    : deletesInternalWake
      ? `${confirmDelete ? 'Confirm delete' : 'Delete'} queued item ${index + 1}: ${item.text}`
      : `Return to input queued item ${index + 1}: ${item.text}`
  const failed = item.delivery === 'failed'
  // Three deliveries are worth a word: steering, a report held until its siblings report, and
  // one that failed every retry. Everything else simply waits its turn.
  const steering =
    item.delivery === 'next-tool' || item.delivery === 'held' || failed ? (
      <span
        className={[
          'flex items-center gap-1 text-2xs',
          failed ? 'text-destructive' : 'text-text-faint',
        ].join(' ')}
      >
        {failed ? (
          <TriangleAlert className="size-3" aria-hidden="true" />
        ) : item.delivery === 'held' ? (
          <Hourglass className="size-3" aria-hidden="true" />
        ) : (
          <CornerDownRight className="size-3" aria-hidden="true" />
        )}
        {queueDeliveryLabel(item.delivery)}
      </span>
    ) : undefined
  // A failed item's one forward action is a retry, whatever its kind.
  const canSend = failed || capabilities?.canPromote

  return (
    <WorkbenchListRow role="listitem" density="dense" aria-busy={busy} className="gap-2 px-2">
      <WorkbenchListRowLeading className="w-3 font-mono text-2xs text-text-faint">
        {index + 1}
      </WorkbenchListRowLeading>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <QueueItemGlyph item={item} />
      </span>
      <span
        className="min-w-0 flex-1 text-xs leading-snug text-text-soft"
        title={item.failure ? `${item.text}\n${item.failure}` : item.text}
      >
        <span className="block truncate">{item.agent ? item.agent.name : item.text}</span>
        {feedback && (
          <span role="status" className="block truncate text-text-faint">
            {feedback}
          </span>
        )}
      </span>
      <WorkbenchListRowActions
        aria-label={`Queued item ${index + 1} actions`}
        visibility="hover"
        fallback={steering}
      >
        {canSend && onSendNow && (
          <IconButton
            size="sm"
            aria-label={`${failed ? 'Retry' : capabilities?.promoteLabel} queued item ${index + 1}: ${item.text}`}
            tooltip={
              failed
                ? 'Put this back in line and try again'
                : 'Stop the current response and send this message now'
            }
            tooltipSide="top"
            disabled={busy}
            onClick={onSendNow}
          >
            {pendingAction === 'send' ? (
              <LoaderCircle className="animate-spin" />
            ) : failed ? (
              <RotateCcw />
            ) : (
              <SendHorizontal />
            )}
          </IconButton>
        )}
        <IconButton
          size="sm"
          tone={confirmsDelete ? 'danger' : 'default'}
          aria-pressed={confirmsDelete ? confirmDelete : undefined}
          tooltip={
            item.agent
              ? 'Cancel this turn'
              : capabilities?.canReturnToComposer === false
                ? confirmDelete
                  ? 'Confirm deleting internal wake'
                  : 'Delete internal wake'
                : 'Return to input field'
          }
          tooltipSide="top"
          aria-label={removeLabel}
          disabled={busy}
          onClick={() => {
            if (confirmsDelete && !confirmDelete) {
              setConfirmDelete(true)
              return
            }
            setConfirmDelete(false)
            onRemove()
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {pendingAction === 'remove' ? (
            <LoaderCircle className="animate-spin" />
          ) : confirmDelete ? (
            // The armed state must look different from hover, or the first click reads as broken.
            <Check />
          ) : item.agent ? (
            <X />
          ) : deletesInternalWake ? (
            <Trash2 />
          ) : (
            <Undo2 />
          )}
        </IconButton>
      </WorkbenchListRowActions>
    </WorkbenchListRow>
  )
}
