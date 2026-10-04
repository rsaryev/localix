import { randomUUID } from 'node:crypto'

import type { MessageBinding } from '@localixai/agent'

import type { ParticipantRef, StoredMessagePayload, StoredSystemNotice } from '../../../db'
import { SYSTEM_PARTICIPANT, USER_PARTICIPANT } from '../../../db'
import type { PersistedMessage } from '../contracts'
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import { toPersistedMessage, emptyAssistantPayload } from './message-envelope'
import { noticeVisibility } from '../system-notice-audience'
import { systemNoticeBinding } from '../system-notice-bindings'

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

/** What every standalone user row needs; the payload flag is what distinguishes them. */
interface UserRowParams {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  userId: string
  sessionId: string
  content: string
  /** Stable id supplied by durable delivery so replay after insert-before-ack is idempotent. */
  messageId?: string
  /** Optimistic UI rows represented by this persisted user message. */
  clientMessageIds?: string[]
}

/**
 * Persist + publish ONE standalone `user` row (no assistant turn, no run).
 *
 * `user` is the only non-assistant/tool role the payload allows, so both kinds of
 * standalone row below are user rows; what actually separates them is a single
 * payload flag, which is `mark`'s whole job. Keeping the insert+publish in one
 * place means the two kinds cannot drift apart in how they reach the transcript.
 */
async function insertUserRow(
  params: UserRowParams,
  mark:
    // Notice prose is always presentation-only; the sibling system context binding is what the
    // room receives through the runtime tail.
    | { uiOnly?: true; systemNotice?: StoredSystemNotice }
    | { origin: 'user-steer' }
    | { isInternal: true; origin: string },
): Promise<PersistedMessage> {
  const messageId = params.messageId ?? randomUUID()
  const createdAt = params.now()
  const noticeBinding =
    'systemNotice' in mark && mark.systemNotice
      ? systemNoticeBinding(mark.systemNotice, messageId, createdAt)
      : undefined
  const message = toPersistedMessage(
    params.userId,
    params.sessionId,
    {
      id: messageId,
      role: 'user',
      from:
        'origin' in mark && mark.origin === 'user-steer' ? USER_PARTICIPANT : SYSTEM_PARTICIPANT,
      content: params.content,
      ...(params.clientMessageIds?.length ? { clientMessageIds: params.clientMessageIds } : {}),
      ...(noticeBinding ? { bindings: [noticeBinding] } : {}),
      ...mark,
    },
    createdAt,
  )
  const canReadExisting = typeof params.repo.getMessage === 'function'
  const existing =
    params.messageId && canReadExisting
      ? await params.repo.getMessage(params.userId, params.sessionId, params.messageId)
      : null
  if (existing) return existing
  try {
    await params.repo.insertMessage(message)
  } catch (error) {
    // Another process can win the same deterministic delivery between the read
    // and insert. Treat that exact row as committed; propagate every other error.
    if (!params.messageId || !canReadExisting) throw error
    const raced = await params.repo.getMessage(params.userId, params.sessionId, params.messageId)
    if (!raced) throw error
    return raced
  }
  params.streamRegistry.publish(params.userId, params.sessionId, {
    type: 'message.created',
    sessionId: params.sessionId,
    message,
  })
  return message
}

/**
 * Insert a single UI-ONLY marker message: rendered in the transcript (as a thin
 * `uiOnly` divider, not a chat bubble) but EXCLUDED from the model context via
 * `payload.uiOnly`. Unlike {@link insertInternalTurn} it adds NO assistant turn
 * and starts NO run — it is a pure human-facing annotation (e.g. a mode-switch
 * marker). The `uiOnly` flag is what drives both the render and the model-context
 * exclusion. Returns the row.
 */
export function insertUiNote(
  params: UserRowParams & { systemNotice?: StoredSystemNotice },
): Promise<PersistedMessage> {
  return insertUserRow(params, {
    // Both notice writers use the same visibility rule. Model visibility belongs to the
    // binding reducer, never to the visible prose row or the writer that happened to create it.
    ...noticeVisibility(params.systemNotice),
    ...(params.systemNotice ? { systemNotice: params.systemNotice } : {}),
  })
}

/**
 * Persist + publish a user message STEERED into an in-flight run (injected on the
 * wire at a turn boundary). A real user row — rendered, model-visible — tagged
 * `origin: 'user-steer'` so the UI can badge it and the NEXT run's model view can
 * carry a causality note (its row sits after the run's still-growing assistant row).
 */
export function insertSteeredUserMessage(
  params: UserRowParams,
  source?: string,
): Promise<PersistedMessage> {
  return source
    ? insertUserRow(params, { isInternal: true, origin: source })
    : insertUserRow(params, { origin: 'user-steer' })
}

/** Build the user half of an atomic steering turn; provenance never implies visibility. */
export function createSteeredUserMessage(
  params: UserRowParams & { internal: boolean; source?: string },
): PersistedMessage {
  return toPersistedMessage(
    params.userId,
    params.sessionId,
    {
      id: params.messageId ?? randomUUID(),
      role: 'user',
      from: USER_PARTICIPANT,
      content: params.content,
      ...(params.clientMessageIds?.length ? { clientMessageIds: params.clientMessageIds } : {}),
      ...(params.internal ? { isInternal: true, origin: params.source } : { origin: 'user-steer' }),
    },
    params.now(),
  )
}

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
