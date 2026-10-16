import type { StoredMessagePayload } from '../../../db'
import { createBoundedCache } from '../../../lib/bounded-cache'
import { createKeyedSerializer } from '../../../lib/keyed-serializer'
import type { ChatRepository, SessionRecord } from '../repository'
import type { RuntimeState } from './agent-runner-state'
import {
  persistAndPublish as persistAndPublishMessage,
  publishMessageSnapshot as publishStoredMessageSnapshot,
  type PersistKnownState,
} from './message-persistence'
import type { SessionStreamRegistry } from './session-stream-registry'
import {
  markRuntimeSessionStatus as updateRuntimeSessionStatus,
  publishChildSummary as publishRuntimeChildSummary,
} from './session-status'

export interface RunnerPublishingDeps {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  liveItemResolvers: RuntimeState['liveItemResolvers']
}

/**
 * How the runner WRITES a message or a session status and tells every client — the persistence
 * half of the runner, bound once to its repository and stream registry.
 *
 * One instance per runner because the message writer carries state that must be shared by every
 * writer of the same message: the run flow, background-job flushes and the delegate live-resolver
 * all persist the same assistant row, and only a single serializer keyed by message id keeps
 * their writes in issue order.
 */
export function createRunnerPublishing({
  repo,
  streamRegistry,
  now,
  liveItemResolvers,
}: RunnerPublishingDeps) {
  const publishChildSummary = (parentSessionId: string, child: SessionRecord) =>
    publishRuntimeChildSummary({ streamRegistry, parentSessionId, child })

  const markRuntimeSessionStatus = (
    userId: string,
    session: SessionRecord,
    status: SessionRecord['runtimeStatus'],
  ) =>
    updateRuntimeSessionStatus({
      repo,
      streamRegistry,
      now,
      userId,
      session,
      status,
      liveItemResolvers,
    })

  const publishMessageSnapshot = (
    userId: string,
    sessionId: string,
    messageId: string,
    payload: StoredMessagePayload,
    createdAt: string,
    updatedAt: string,
  ) =>
    publishStoredMessageSnapshot({
      streamRegistry,
      userId,
      sessionId,
      messageId,
      payload,
      createdAt,
      updatedAt,
    })

  // Un-chained, concurrent persists of the SAME message could reorder and leave a transiently
  // stale DB row. So writes are serialized per message: each call captures its payload
  // (state.currentPayload, reassigned not mutated) at issue time, and FIFO chaining lands the
  // newest snapshot last.
  const serializePersist = createKeyedSerializer()
  // Last written { payloadJson, payload } per streaming message — handed back to
  // updateMessage as the parse-skip hint (verified against the row by string
  // compare, so a foreign write just means one parse fallback, never stale data).
  // Bounded LRU: streaming messages alive at once are few; evict the oldest.
  const persistKnown = createBoundedCache<string, PersistKnownState>({ maxEntries: 64 })
  const persistAndPublish = (
    userId: string,
    sessionId: string,
    messageId: string,
    payload: StoredMessagePayload,
    createdAt: string,
  ): Promise<void> =>
    serializePersist(messageId, async () => {
      const written = await persistAndPublishMessage({
        repo,
        streamRegistry,
        now,
        userId,
        sessionId,
        messageId,
        payload,
        createdAt,
        known: persistKnown.get(messageId),
      })
      if (written) persistKnown.set(messageId, written)
      else persistKnown.delete(messageId)
    })

  return {
    publishChildSummary,
    markRuntimeSessionStatus,
    publishMessageSnapshot,
    persistAndPublish,
  }
}
