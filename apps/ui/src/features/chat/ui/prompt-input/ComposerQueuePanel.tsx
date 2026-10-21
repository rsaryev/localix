import { memo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { backendClient } from '@/shared/api/client'
import type { QueueRemovalResult, SessionQueueItem } from '@/shared/api/contracts'
import { composerBus } from '@/shared/lib/composerBus'
import { toast } from '@/shared/lib/notify'
import { QueuePanel, type QueuePanelItem } from './QueuePanel'
import { QueueDockPill } from './QueueDockPill'
import { clearServerQueue, deleteServerQueueItem, returnServerQueueItem } from './queue-actions'
import { useChatStore } from '@/features/chat/model/store'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { pluginContribSnapshot } from '@/shared/contrib/enabledPlugins'
import { resolveAuthorIdentity } from '@/shared/contrib/useAgentIdentity'
import { usePluginContribVersion } from '@/shared/contrib/usePluginContribVersion'
import { applyServerSession } from '@/features/chat/model/sessionSync'

interface ComposerQueuePanelProps {
  /** Backend-owned queue: messages waiting behind the in-flight run. */
  serverQueue?: SessionQueueItem[]
  activeSessionId: string | null
}

/**
 * The queue docked beside send: a pill of what waits, and the full list in a popover that opens
 * upward over the chat. Neither changes the composer's height. Returns null when empty.
 *
 * Memoized: `serverQueue` is the session's own array from the store, so a
 * keystroke no longer re-renders the queued-message list.
 */
export const ComposerQueuePanel = memo(function ComposerQueuePanel({
  serverQueue,
  activeSessionId,
}: ComposerQueuePanelProps) {
  // A rename publishes a new contribution version; reading it re-resolves the names below.
  usePluginContribVersion()
  const agents = pluginContribSnapshot().document?.agents ?? []
  const queue: QueuePanelItem[] = (serverQueue ?? []).map((q): QueuePanelItem => {
    const agent = q.agentId ? resolveAuthorIdentity(q.agentId, undefined, agents) : undefined
    return {
      id: q.id,
      // The ticket's own text is the runtime's ("Turn for <agent id>"); a person reads a name.
      text: agent ? `${agent.name} — waiting to answer` : q.preview,
      queueKind: q.kind,
      wakeSource: q.source,
      delivery: q.delivery,
      ...(q.failure ? { failure: q.failure } : {}),
      ...(agent ? { agent: { handle: agent.handle, name: agent.name } } : {}),
    }
  })
  /**
   * A remove the server refused, in the person's words. A `batched` item was claimed with others
   * and is delivered as one turn with them, so it leaves only with all of them: offer that.
   */
  const explainRefusal = (
    result: Exclude<QueueRemovalResult, { removed: true }>,
    noun: 'message' | 'wake',
    removeBatch: () => unknown,
  ) => {
    if (result.reason === 'batched')
      return toast.info(`This queued ${noun} is sent together with ${result.batchSize - 1} more`, {
        description: 'They are delivered as one turn, so they leave the queue together.',
        action: { label: `Remove all ${result.batchSize}`, onClick: () => void removeBatch() },
      })
    toast.info(
      result.reason === 'leased'
        ? noun === 'wake'
          ? 'This queued wake is already being delivered'
          : 'This queued message is already being sent'
        : `This queued ${noun} is no longer available`,
    )
  }
  const [open, setOpen] = useState(false)
  // The list closes with the queue: an open popover over nothing would be a stray frame.
  if (queue.length === 0 && open) setOpen(false)
  if (queue.length === 0) return null
  const onRemove = (item: QueuePanelItem, wholeBatch = false): Promise<unknown> | undefined => {
    if (!activeSessionId) return
    const remove = (sessionId: string, itemId: string) =>
      backendClient.removeQueuedMessage(sessionId, itemId, wholeBatch ? { wholeBatch } : undefined)
    if (item.queueKind === 'wake') {
      return deleteServerQueueItem({ sessionId: activeSessionId, itemId: item.id, remove })
        .then((result) => {
          if (!result.removed) explainRefusal(result, 'wake', () => onRemove(item, true))
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
      remove,
      restore: ({ content, bindings }) =>
        composerBus.insert({
          sessionId: activeSessionId,
          text: content,
          bindings,
          buffer: true,
        }),
      onRemoved: () => {
        // A whole batch leaves together: every optimistic row it stood for goes with it.
        const batchId = serverQueue?.find((candidate) => candidate.id === item.id)?.batchId
        for (const queued of serverQueue ?? []) {
          if (!queued.clientMessageId) continue
          if (queued.id === item.id || (wholeBatch && batchId && queued.batchId === batchId))
            useChatStore
              .getState()
              ._dropOptimistic(activeSessionId, { userId: queued.clientMessageId })
        }
      },
    })
      .then((result) => {
        if (!result.removed) explainRefusal(result, 'message', () => onRemove(item, true))
      })
      .catch((err: unknown) =>
        toast.error('Could not return the queued message to the composer', {
          description: errorMessage(err, '') || undefined,
        }),
      )
  }
  const onSendNow = (item: QueuePanelItem) => {
    if (!activeSessionId) return
    return backendClient
      .interruptAndPromoteQueuedMessage(activeSessionId, item.id)
      .then(async (result) => {
        if (result.promoted)
          return {
            message:
              item.delivery === 'failed'
                ? 'Back in line — trying again.'
                : 'Accepted — starting the queued turn…',
          }
        if (result.reason === 'not_found' || result.reason === 'not_user') {
          // A lost queue event can leave an obsolete row clickable indefinitely.
          // Reconcile that row with the server instead of inviting endless retries.
          try {
            const latest = await backendClient.getSession(activeSessionId)
            if (useChatStore.getState().activeSessionId === activeSessionId)
              applyServerSession(latest)
          } catch {
            // The inline status still explains the failed promotion.
          }
        }
        return {
          message:
            result.reason === 'leased'
              ? 'Already being delivered; wait for the current turn.'
              : result.reason === 'batched'
                ? 'Sent together with other queued messages; it goes with them.'
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
  }
  const onClear = () => {
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
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <QueueDockPill queue={queue} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        aria-label="Queue"
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-1.5"
      >
        <QueuePanel queue={queue} onRemove={onRemove} onSendNow={onSendNow} onClear={onClear} />
      </PopoverContent>
    </Popover>
  )
})
