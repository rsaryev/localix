import { randomUUID } from 'node:crypto'

import type { MessageBinding } from '@localixai/agent'

import type { ParticipantRef, StoredMessagePayload } from '../../../db'
import { SYSTEM_PARTICIPANT, USER_PARTICIPANT } from '../../../db'
import type { PersistedMessage } from '../contracts'
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import { toPersistedMessage, emptyAssistantPayload } from './message-envelope'

export function publishMessageSnapshot(params: {
  streamRegistry: SessionStreamRegistry
  userId: string
  sessionId: string
  messageId: string
  payload: StoredMessagePayload
  createdAt: string
  updatedAt: string
}) {
  const persisted: PersistedMessage = {
    id: params.messageId,
    sessionId: params.sessionId,
    userId: params.userId,
    payload: params.payload,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  }
  params.streamRegistry.publish(params.userId, params.sessionId, {
    type: 'message.updated',
    sessionId: params.sessionId,
    message: persisted,
  })
}

export {
  insertUiNote,
  insertSteeredUserMessage,
  createSteeredUserMessage,
} from './standalone-user-row'

/**
 * The `{ payloadJson, payload }` a streaming writer got back from its previous
 * `updateMessage` — passed back in so the next flush can skip the O(payload)
 * JSON.parse when nothing else wrote the row in between (see repository.updateMessage).
 */
export interface PersistKnownState {
  payloadJson: string
  payload: StoredMessagePayload
}

/**
 * Persist the run's in-memory assistant snapshot and publish it.
 *
 * It still takes the WHOLE payload — not because the write wants one (the write takes a
 * patch; see `StoredMessagePatch`), but because the SSE side of this pair must ship a whole
 * `PersistedMessage`, which needs the payload's `id` + `role`. Those two are the row's
 * IDENTITY, so they are peeled off here and never reach the writer: what goes to the DB is
 * the delta, and what comes back is the merged row — including any field a SECOND author
 * (e.g. `service/review-ops.ts` stamping `review`) put there while this run was streaming.
 * That merged payload is what we publish, so the live transcript never blinks a foreign
 * field away either.
 *
 * Returns the written `{ payload, payloadJson }` (null when the row is gone) so the caller
 * can hand it back as `known` on the next flush of the same message.
 */
export async function persistAndPublish(params: {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  userId: string
  sessionId: string
  messageId: string
  payload: StoredMessagePayload
  createdAt: string
  known?: PersistKnownState
}): Promise<PersistKnownState | null> {
  const updatedAt = params.now()
  const {
    id: _id,
    role: _role,
    from: _from,
    authorSnapshot: _snapshot,
    continuedFromMessageId: _continuation,
    ...patch
  } = params.payload
  const written = await params.repo.updateMessage(
    params.userId,
    params.sessionId,
    params.messageId,
    patch,
    updatedAt,
    params.known,
  )
  publishMessageSnapshot({
    streamRegistry: params.streamRegistry,
    userId: params.userId,
    sessionId: params.sessionId,
    messageId: params.messageId,
    // Row already gone (deleted mid-run): nothing was written, but keep publishing the
    // snapshot we were handed — same as before this became a merge.
    payload: written?.payload ?? params.payload,
    createdAt: params.createdAt,
    updatedAt,
  })
  return written
}

/**
 * Insert a user message + an empty streaming assistant message and publish both
 * — the standard preamble for a continuation / wake run. Internal by default
 * (loop/plugin/continuation wakes); pass `internal: false` for a real user turn
 * queued while the session was busy (so it renders as a normal user message and
 * is NOT hidden from the model context). Returns the persisted pair so the
 * caller can start a run on the assistant id.
 */
export async function insertInternalTurn(params: {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  userId: string
  sessionId: string
  /** Who answers this turn — the session's agent. Stated by the caller, which has the session. */
  agent: ParticipantRef
  content: string
  /** Default true. False = a genuine user turn (queued while busy). */
  internal?: boolean
  /** Opaque provenance tag (the domain `WakeSource`), persisted on the user row. */
  origin?: string
  /**
   * Which participant this routed turn concerns, with its handle frozen for display.
   * The conversation shows it whole to that participant and as one line to the rest
   * (`participant-view`).
   */
  to?: { participant: ParticipantRef; handle?: string }
  bindings?: MessageBinding[]
  /** Plugins whose tools the answering turn carries — the plugin that woke it. */
  plugins?: string[]
  /** The badge of a slash command that waited in the queue ("via /loop · every 5m"). */
  commandOrigin?: { command: string; label: string }
  /** Optimistic UI rows represented by this (possibly merged) queued turn. */
  clientMessageIds?: string[]
  /** Stable pair supplied by durable delivery; retries address the same turn. */
  messageIds?: { userMessageId: string; assistantMessageId: string }
}): Promise<{ userMessage: PersistedMessage; assistantMessage: PersistedMessage }> {
  const timestamp = params.now()
  const internal = params.internal ?? true

  const makeCreated = (payload: StoredMessagePayload): PersistedMessage =>
    toPersistedMessage(params.userId, params.sessionId, payload, timestamp)
  const publishCreated = (message: PersistedMessage): void => {
    params.streamRegistry.publish(params.userId, params.sessionId, {
      type: 'message.created',
      sessionId: params.sessionId,
      message,
    })
  }

  const userMessage = makeCreated({
    id: params.messageIds?.userMessageId ?? randomUUID(),
    role: 'user',
    // A visible queued turn is something the PERSON sent while the session was busy; only a
    // hidden one is the system speaking. The row used to say `system` for both.
    from: internal ? SYSTEM_PARTICIPANT : USER_PARTICIPANT,
    content: params.content,
    ...(internal ? { isInternal: true } : {}),
    ...(params.commandOrigin ? { commandOrigin: params.commandOrigin } : {}),
    ...(params.origin ? { origin: params.origin } : {}),
    ...(params.to ? { to: params.to.participant } : {}),
    ...(params.to?.handle ? { toSnapshot: { handle: params.to.handle } } : {}),
    ...(params.bindings && params.bindings.length > 0 ? { bindings: params.bindings } : {}),
    ...(params.plugins?.length ? { plugins: params.plugins } : {}),
    ...(params.clientMessageIds?.length ? { clientMessageIds: params.clientMessageIds } : {}),
  })

  const assistantMessage = makeCreated(
    emptyAssistantPayload(params.messageIds?.assistantMessageId ?? randomUUID(), params.agent),
  )
  if (params.messageIds) {
    const [existingUser, existingAssistant] = await Promise.all([
      params.repo.getMessage(params.userId, params.sessionId, params.messageIds.userMessageId),
      params.repo.getMessage(params.userId, params.sessionId, params.messageIds.assistantMessageId),
    ])
    if (existingUser && existingAssistant) {
      return { userMessage: existingUser, assistantMessage: existingAssistant }
    }
    if (existingUser || existingAssistant) {
      throw new Error('Durable queued turn is partially committed')
    }
  }
  // One DB transaction: a failed assistant insert cannot strand an orphan user row.
  try {
    await params.repo.insertMessages([userMessage, assistantMessage])
  } catch (error) {
    if (!params.messageIds) throw error
    const [racedUser, racedAssistant] = await Promise.all([
      params.repo.getMessage(params.userId, params.sessionId, params.messageIds.userMessageId),
      params.repo.getMessage(params.userId, params.sessionId, params.messageIds.assistantMessageId),
    ])
    if (!racedUser || !racedAssistant) throw error
    return { userMessage: racedUser, assistantMessage: racedAssistant }
  }
  publishCreated(userMessage)
  publishCreated(assistantMessage)

  return { userMessage, assistantMessage }
}
