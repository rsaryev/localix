import { USER_PARTICIPANT, type StoredMessagePayload } from '../../../db'
import type { createChatRepository } from '../repository'
import type { PersistedMessage } from '../contracts'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import {
  toPersistedMessage,
  emptyAssistantPayload,
  sessionAgent,
} from '../runtime/message-envelope'
import { autoTitle, DEFAULT_TITLE } from './context'
import type { SessionRecord } from '../repository'
import { SESSION_GOAL_MAX_CHARS } from '../../agent-core/session-topic'

type ChatRepo = ReturnType<typeof createChatRepository>

// `toPersistedMessage` + `emptyAssistantPayload` live in the lower runtime/ layer
// so runtime message-insert paths can share the same envelope shapes; re-export
// keeps service/ callers stable.
export { toPersistedMessage, emptyAssistantPayload, sessionAgent }

/**
 * Persist a message and emit the `message.created` firehose event — the
 * insert+publish pair every message-mutating service path repeats. Returns the
 * persisted record so callers can keep using it (e.g. for autoTitle history).
 */
export async function persistAndPublishMessage(
  repo: ChatRepo,
  streamRegistry: SessionStreamRegistry,
  userId: string,
  sessionId: string,
  payload: StoredMessagePayload,
  timestamp: string,
): Promise<PersistedMessage> {
  const persisted = toPersistedMessage(userId, sessionId, payload, timestamp)
  await repo.insertMessage(persisted)
  streamRegistry.publish(userId, sessionId, {
    type: 'message.created',
    sessionId,
    message: persisted,
  })
  return persisted
}

/**
 * Advance the session row after a turn's user message has landed: derive the auto
 * title from the history INCLUDING that message, stamp `updatedAt`/`lastMessageAt`,
 * persist, and publish `session.updated`.
 *
 * Every path that starts a turn from a user-authored message does exactly this and
 * must keep doing exactly this — a session whose `lastMessageAt` did not move sorts
 * wrong in the sidebar, and a first message that did not seed the title leaves the
 * session named "New chat" forever. Returns the updated record, which callers hand
 * to the runner as the run's session snapshot.
 */
export async function bumpSessionForTurn(
  repo: ChatRepo,
  publishSession: (session: SessionRecord) => void,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  /** The turn's history INCLUDING the just-persisted user message. */
  historyWithUserMessage: PersistedMessage[],
  timestamp: string,
): Promise<SessionRecord> {
  const firstUserMessage = historyWithUserMessage.find(
    ({ payload }) =>
      payload.role === 'user' &&
      !payload.isInternal &&
      !payload.uiOnly &&
      (!payload.from || payload.from === USER_PARTICIPANT) &&
      payload.content?.trim(),
  )
  if (session.goal == null || session.title === DEFAULT_TITLE) {
    await repo.seedSessionTopic(
      userId,
      sessionId,
      autoTitle(session.title, historyWithUserMessage),
      firstUserMessage?.payload.content?.trim().slice(0, SESSION_GOAL_MAX_CHARS) ?? null,
    )
  }
  // A partial patch never writes an older summary, roster, or runtime status back to the row.
  await repo.updateSession(userId, sessionId, {
    updatedAt: timestamp,
    lastMessageAt: timestamp,
  })
  const updatedSession = await repo.getSession(userId, sessionId)
  if (!updatedSession) throw new Error('Conversation no longer exists.')
  publishSession(updatedSession)
  return updatedSession
}
