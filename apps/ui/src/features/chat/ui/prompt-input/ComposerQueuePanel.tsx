import { memo } from 'react'
import { backendClient } from '@/shared/api/client'
import type { SessionQueueItem } from '@/shared/api/contracts'
import { composerBus } from '@/shared/lib/composerBus'
import { toast } from '@/shared/lib/notify'
import { QueuePanel, type QueuePanelItem } from './QueuePanel'
import { clearServerQueue, deleteServerQueueItem, returnServerQueueItem } from './queue-actions'
import { useChatStore } from '@/features/chat/model/store'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

interface ComposerQueuePanelProps {
  /** Backend-owned queue: messages waiting behind the in-flight run. */
  serverQueue?: SessionQueueItem[]
  activeSessionId: string | null
}

/** Render messages waiting behind the active run; returns null when empty. */
/**
 * Memoized: `serverQueue` is the session's own array from the store, so a
 * keystroke no longer re-renders the queued-message list.
 */
export const ComposerQueuePanel = memo(function ComposerQueuePanel({
  serverQueue,
  activeSessionId,
}: ComposerQueuePanelProps) {
  const queue: QueuePanelItem[] = (serverQueue ?? []).map(
    (q): QueuePanelItem => ({
      id: q.id,
      text: q.preview,
      queueKind: q.kind,
      wakeSource: q.source,
      delivery: q.delivery,
    }),
  )
  if (queue.length === 0) return null
  return (
    <QueuePanel
      queue={queue}
      onRemove={(item) => {
        if (!activeSessionId) return
        if (item.queueKind === 'wake') {
          return deleteServerQueueItem({
            sessionId: activeSessionId,
            itemId: item.id,
            remove: (sessionId, itemId) => backendClient.removeQueuedMessage(sessionId, itemId),
          })
            .then((result) => {
              if (!result.removed)
                toast.info(
                  'reason' in result && result.reason === 'leased'
                    ? 'This queued wake is already being delivered'
                    : 'This queued wake is no longer available',
                )
            })
            .catch((err: unknown) =>
              toast.error('Could not delete the queued wake', {
                description: errorMessage(err, '') || undefined,
              }),
            )
        }
        return returnServerQueueItem({
          sessionId: activeSessionId,
          itemId: item.id,
          remove: (sessionId, itemId) => backendClient.removeQueuedMessage(sessionId, itemId),
          restore: ({ content, bindings }) =>
            composerBus.insert({
              sessionId: activeSessionId,
              text: content,
              bindings,
              buffer: true,
            }),
          onRemoved: () => {
            const queued = serverQueue?.find((candidate) => candidate.id === item.id)
            if (queued?.clientMessageId)
              useChatStore
                .getState()
                ._dropOptimistic(activeSessionId, { userId: queued.clientMessageId })
          },
        })
          .then((result) => {
            if ('reason' in result)
              toast.info(
                result.reason === 'leased'
                  ? 'This queued message is already being sent'
                  : 'This queued message is no longer available',
              )
          })
          .catch((err: unknown) =>
            toast.error('Could not return the queued message to the composer', {
              description: errorMessage(err, '') || undefined,
            }),
          )
      }}
      onSendNow={(item) => {
        if (!activeSessionId) return
        return backendClient
          .interruptAndPromoteQueuedMessage(activeSessionId, item.id)
          .then(async (result) => {
            if (result.promoted) return { message: 'Accepted — starting the queued turn…' }
            if (result.reason === 'not_found' || result.reason === 'not_user') {
              // A lost queue event can leave an obsolete row clickable indefinitely.
              // Reconcile that row with the server instead of inviting endless retries.
              try {
                const latest = await backendClient.getSession(activeSessionId)
                if (useChatStore.getState().activeSessionId === activeSessionId)
                  useChatStore.getState()._replaceSession(latest)
              } catch {
                // The inline status still explains the failed promotion.
              }
            }
            return {
              message:
                result.reason === 'leased'
                  ? 'Already being delivered; wait for the current turn.'
                  : result.reason === 'not_user'
                    ? 'An internal wake cannot be sent as your message.'
                    : 'No longer in the server queue; refresh this session.',
            }
          })
          .catch((err: unknown) => {
            toast.error('Could not interrupt the run to send the queued message', {
              description: errorMessage(err, '') || undefined,
            })
            return { message: 'Send failed — try again.' }
          })
      }}
      onClear={() => {
        if (!activeSessionId) return
        if ((serverQueue?.length ?? 0) > 0)
          return clearServerQueue({
            sessionId: activeSessionId,
            clear: (sessionId) => backendClient.clearQueuedMessages(sessionId),
          })
            .then((result) => {
              const retained = new Set(result.retained)
              for (const queued of serverQueue ?? []) {
                if (queued.clientMessageId && !retained.has(queued.id))
                  useChatStore
                    .getState()
                    ._dropOptimistic(activeSessionId, { userId: queued.clientMessageId })
              }
              const kept = result.retained.length
              if (kept > 0)
                toast.info(
                  kept === 1
                    ? 'One queued item is already being delivered'
                    : `${kept} queued items are already being delivered`,
                  { description: 'The rest of the queue was cleared.' },
                )
            })
            .catch((err: unknown) =>
              toast.error('Could not clear the queue', {
                description: errorMessage(err, '') || undefined,
              }),
            )
      }}
    />
  )
})
