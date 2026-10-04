import {
  agentParticipant,
  conversationAgent,
  type ParticipantRef,
  type StoredMessagePayload,
} from '../../../db'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'

/**
 * Who the assistant side of this session speaks as.
 *
 * Every row an agent writes states its author, and in a private chat that author is the
 * session's counterpart. Taking the persisted assignment at each call site is
 * what makes it impossible to persist a turn attributed to nobody.
 */
export function sessionAgent(
  session: Pick<SessionRecord, 'agents'>,
  agentId?: string,
): `agent:${string}` {
  return agentId ? agentParticipant(agentId) : conversationAgent(session.agents)
}

/**
 * The empty assistant message payload the agent streams into — a freshly
 * created slot (pass a new id) or the missing-row fallback (pass the known
 * assistant message id). Centralizes the `{ role: "assistant", content: "" }`
 * shape repeated across the run-dispatch + branching paths.
 */
export function emptyAssistantPayload(id: string, from: ParticipantRef): StoredMessagePayload {
  return { id, role: 'assistant', content: '', from }
}

/**
 * Wrap a stored payload into the persisted-message envelope (id mirrors
 * payload.id; createdAt === updatedAt for a freshly created row).
 *
 * Lives in `runtime/` (the lower layer) so both runtime/ message-insert paths
 * and the service/ layer above can share the single envelope shape. `service/`
 * re-exports it from `service/message-builders.ts` for its callers.
 */
export function toPersistedMessage(
  userId: string,
  sessionId: string,
  payload: StoredMessagePayload,
  timestamp: string,
): PersistedMessage {
  return {
    id: payload.id,
    sessionId,
    userId,
    payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
