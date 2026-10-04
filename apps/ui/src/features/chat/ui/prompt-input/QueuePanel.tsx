import { useRef, useState } from 'react'
import { Clock3, CornerDownRight, LoaderCircle, SendHorizontal, Undo2, Trash2 } from 'lucide-react'
import { StatusDot } from '@localixai/kit/status-dot'
import { CollapsibleStrip } from '@localixai/kit/collapsible-strip'
import { IconButton } from '@localixai/kit/icon-button'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
  WorkbenchListRowMeta,
} from '@localixai/kit/workbench-list-row'
import type { SessionQueueItem, WakeSource } from '@/shared/api/contracts'
import { WAKE_SOURCE_META } from './wakeSourceMeta'
import { queueDeliveryLabel, queueItemCapabilities } from '@localixai/api/queue-presentation'

/** One row in the backend-owned composer queue. */
export interface QueuePanelItem {
  id: string
  text: string
  /** Backend queue kind; internal wakes cannot be promoted as user input. */
  queueKind?: SessionQueueItem['kind']
  /** Backend items only: provenance of the queued wake (loop / plugin / …). */
  wakeSource?: WakeSource
  /** Backend delivery boundary; next-tool is live steering, not a later turn. */
  delivery?: SessionQueueItem['delivery']
}

function DeliveryBadge({ delivery }: { delivery?: QueuePanelItem['delivery'] }) {
  const label = queueDeliveryLabel(delivery)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex h-6 items-center text-text-faint"
    >
      {delivery === 'next-tool' ? (
        <CornerDownRight className="size-3.5" aria-hidden="true" />
      ) : (
        <Clock3 className="size-3.5" aria-hidden="true" />
      )}
    </span>
  )
}

/** Small monochrome provenance glyph for a queued wake, in the strips' visual language. */
function SourceBadge({ source }: { source: WakeSource }) {
  const meta = WAKE_SOURCE_META[source]
  if (!meta) return null
  const { Icon, label } = meta
  return (
    <span title={label} className="flex shrink-0">
      <Icon className="size-3 text-text-faint opacity-70" aria-label={label} />
    </span>
  )
}

interface QueuePanelProps {
  queue: QueuePanelItem[]
  onRemove: (item: QueuePanelItem) => unknown
  onSendNow?: (item: QueuePanelItem) => unknown
  onClear: () => unknown
}

function QueueItemRow({
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
  const capabilities = item.queueKind ? queueItemCapabilities(item.queueKind) : null
  const removeLabel = deletesInternalWake
    ? `${confirmDelete ? 'Confirm delete' : 'Delete'} queued item ${index + 1}: ${item.text}`
    : `Return to input queued item ${index + 1}: ${item.text}`

  return (
    <WorkbenchListRow
      role="listitem"
      density="dense"
      aria-busy={busy}
      className="gap-1.5 rounded-lg bg-surface-raised/40 px-2 py-1"
    >
      <WorkbenchListRowLeading className="font-mono text-2xs">{index + 1}</WorkbenchListRowLeading>
      {item.wakeSource && <SourceBadge source={item.wakeSource} />}
      <span className="min-w-0 flex-1 text-xs leading-snug text-text-soft" title={item.text}>
        <span className="block truncate">{item.text}</span>
        {feedback && (
          <span role="status" className="block truncate text-text-faint">
            {feedback}
          </span>
        )}
      </span>
      <WorkbenchListRowMeta className="flex h-6 items-center px-0">
        <DeliveryBadge delivery={item.delivery} />
      </WorkbenchListRowMeta>
      <WorkbenchListRowActions aria-label={`Queued item ${index + 1} actions`}>
        {capabilities?.canPromote && onSendNow && (
          <IconButton
            size="sm"
            aria-label={`${capabilities.promoteLabel} queued item ${index + 1}: ${item.text}`}
            tooltip="Stop the current response and send this message now"
            tooltipSide="top"
            disabled={busy}
            onClick={onSendNow}
          >
            {pendingAction === 'send' ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="size-3.5" />
            )}
          </IconButton>
        )}
        <IconButton
          size="sm"
          tone={deletesInternalWake ? 'danger' : 'default'}
          aria-pressed={deletesInternalWake ? confirmDelete : undefined}
          tooltip={
            capabilities?.canReturnToComposer === false
              ? confirmDelete
                ? 'Confirm deleting internal wake'
                : 'Delete internal wake'
              : 'Return to input field'
          }
          tooltipSide="top"
          aria-label={removeLabel}
          disabled={busy}
          onClick={() => {
            if (deletesInternalWake && !confirmDelete) {
              setConfirmDelete(true)
              return
            }
            setConfirmDelete(false)
            onRemove()
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {pendingAction === 'remove' ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : deletesInternalWake ? (
            <Trash2 className="size-3.5" />
          ) : (
            <Undo2 className="size-3.5" />
          )}
        </IconButton>
      </WorkbenchListRowActions>
    </WorkbenchListRow>
  )
}

export function QueuePanel({ queue, onRemove, onSendNow, onClear }: QueuePanelProps) {
  const [expanded, setExpanded] = useState(true)
  const pendingRef = useRef(false)
  const [pending, setPending] = useState<{
    id: string
    action: 'send' | 'remove' | 'clear'
  } | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; message: string } | null>(null)
  const runAction = async (
    id: string,
    kind: 'send' | 'remove' | 'clear',
    action: () => unknown,
  ) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending({ id, action: kind })
    setFeedback(null)
    try {
      const result: unknown = await action()
      if (
        kind === 'send' &&
        result &&
        typeof result === 'object' &&
        'message' in result &&
        typeof result.message === 'string'
      ) {
        setFeedback({ id, message: result.message })
      }
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }
  // Bind destructive confirmation to the exact server snapshot the user saw.
  // A reconnect can replace/append queue items between the two clicks; in that
  // case newly arrived work must never inherit an already-armed confirmation.
  const [confirmClearFingerprint, setConfirmClearFingerprint] = useState<string | null>(null)

  const total = queue.length
  const queueFingerprint = queue.map((item) => item.id).join('\u0000')
  const confirmClear = confirmClearFingerprint === queueFingerprint
  if (total === 0) return null

  return (
    <CollapsibleStrip
      expanded={expanded}
      onExpandedChange={(next) => {
        setExpanded(next)
        setConfirmClearFingerprint(null)
      }}
      label={{ expand: 'Show queued work', collapse: 'Hide queued work' }}
      icon={<StatusDot className="bg-text-faint opacity-50" />}
      count={total}
      title="Queue"
      summary={queue[0]?.text}
      listLabel="Queued messages"
      actionsLabel="Queue actions"
      actions={
        expanded ? (
          <IconButton
            size="md"
            tone="danger"
            aria-pressed={confirmClear}
            aria-label={confirmClear ? `Confirm clear all ${total} queued items` : 'Clear queue'}
            tooltip={confirmClear ? 'Confirm clearing the entire queue' : 'Clear queue'}
            tooltipSide="top"
            disabled={pending !== null}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClearFingerprint(queueFingerprint)
                return
              }
              setConfirmClearFingerprint(null)
              void runAction('all', 'clear', onClear)
            }}
            onBlur={() => setConfirmClearFingerprint(null)}
          >
            {pending?.action === 'clear' ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
          </IconButton>
        ) : null
      }
    >
      {queue.map((item, index) => (
        <QueueItemRow
          key={item.id}
          item={item}
          index={index}
          busy={pending !== null}
          pendingAction={
            pending?.id === item.id && pending.action !== 'clear' ? pending.action : undefined
          }
          feedback={feedback?.id === item.id ? feedback.message : undefined}
          onRemove={() => {
            void runAction(item.id, 'remove', () => onRemove(item))
          }}
          onSendNow={
            onSendNow
              ? () => {
                  void runAction(item.id, 'send', () => onSendNow(item))
                }
              : undefined
          }
        />
      ))}
    </CollapsibleStrip>
  )
}
