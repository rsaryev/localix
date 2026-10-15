import { useRef, useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { QueueItemRow, type QueuePanelItem } from './QueueRow'
import { useLeavingItems } from './useLeavingItems'

export type { QueuePanelItem } from './QueueRow'

/** `--dur-base`: a row that left collapses on the same beat as the rest of the composer's motion. */
const EXIT_MS = 200

interface QueuePanelProps {
  queue: QueuePanelItem[]
  onRemove: (item: QueuePanelItem) => unknown
  onSendNow?: (item: QueuePanelItem) => unknown
  onClear: () => unknown
}

export function QueuePanel({ queue, onRemove, onSendNow, onClear }: QueuePanelProps) {
  const entries = useLeavingItems(queue, EXIT_MS)
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

  // The full list, opened from the queue rail (`ComposerQueuePanel`): a title, the one action on
  // the whole queue, and a row per item with its own actions.
  const clearButton = (
    <IconButton
      size="sm"
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
      {pending?.action === 'clear' ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
    </IconButton>
  )
  return (
    <div data-slot="queue-panel" className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-xs">
        <span className="font-medium text-text-strong">Queue</span>
        <span className="tabular-nums text-text-faint">{total}</span>
        <span role="group" aria-label="Queue actions" className="ml-auto flex items-center">
          {clearButton}
        </span>
      </div>
      <div
        role="list"
        aria-label="Queued messages"
        className="flex max-h-72 flex-col overflow-y-auto"
      >
        {entries.map(({ item, leaving }, slot) => {
          // A leaving row keeps its slot's number for the beat it takes to fade.
          const index = leaving ? slot : queue.findIndex((queued) => queued.id === item.id)
          return (
            // ENTER rises in; LEAVE collapses its own height while it fades, so the rows below glide
            // up instead of jumping when a turn starts. Both on the motion tokens.
            <div
              key={item.id}
              aria-hidden={leaving || undefined}
              className={[
                'grid transition-[grid-template-rows,opacity] duration-(--dur-base) ease-(--ease-exit) motion-reduce:transition-none',
                leaving
                  ? 'pointer-events-none grid-rows-[0fr] opacity-0'
                  : 'grid-rows-[1fr] animate-fade-up',
              ].join(' ')}
            >
              {/* A leaving row keeps its content, so there is a height to collapse. */}
              <div className="min-h-0 overflow-hidden">
                <QueueItemRow
                  item={item}
                  index={index}
                  busy={leaving || pending !== null}
                  pendingAction={
                    pending?.id === item.id && pending.action !== 'clear'
                      ? pending.action
                      : undefined
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
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
