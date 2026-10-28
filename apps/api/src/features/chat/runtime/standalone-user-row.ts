/** Standalone user rows share one idempotent insert/publish path. */
import { randomUUID } from 'node:crypto'
import type { StoredSystemNotice } from '../../../db'
import { SYSTEM_AUTHOR, USER_AUTHOR } from '../../../db'
import type { PersistedMessage } from '../contracts'
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import { toPersistedMessage } from './message-envelope'
import { noticeVisibility } from '../system-notice-audience'
import { carriesModelContext, systemNoticeBinding } from '../system-notice-bindings'

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
    // agent receives through the runtime tail.
    | { uiOnly?: true; systemNotice?: StoredSystemNotice }
    | { origin: 'user-steer' }
    | { isInternal: true; origin: string },
): Promise<PersistedMessage> {
  const messageId = params.messageId ?? randomUUID()
  const createdAt = params.now()
  const noticeBinding =
    'systemNotice' in mark && mark.systemNotice && carriesModelContext(mark.systemNotice)
      ? systemNoticeBinding(mark.systemNotice, messageId, createdAt)
      : undefined
  const message = toPersistedMessage(
    params.userId,
    params.sessionId,
    {
      id: messageId,
      role: 'user',
      from: 'origin' in mark && mark.origin === 'user-steer' ? USER_AUTHOR : SYSTEM_AUTHOR,
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
      from: USER_AUTHOR,
      content: params.content,
      ...(params.clientMessageIds?.length ? { clientMessageIds: params.clientMessageIds } : {}),
      ...(params.internal ? { isInternal: true, origin: params.source } : { origin: 'user-steer' }),
    },
    params.now(),
  )
}
