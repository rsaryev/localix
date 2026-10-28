import type { SessionRecord } from '../repository'

/**
 * Why a turn is addressed to the session's agent: the person's message (`user-default`), or a
 * delivery the runtime addresses (`runtime`: a job finished, a report arrived, a loop fired).
 */
export type AgentTurnSource = 'user-default' | 'runtime'

export interface ConversationRecipient {
  agentId: string
  source: AgentTurnSource
}

export type ConversationEvent = { kind: 'user-message'; text: string } | { kind: 'runtime' }

/** Who answers: the session's agent, fixed for the session's life; none when it has none. */
export function turnRecipient(
  session: Pick<SessionRecord, 'agent'>,
  event: ConversationEvent,
): ConversationRecipient | undefined {
  const agent = session.agent
  if (!agent) return undefined
  if (event.kind === 'user-message') return { agentId: agent.agentId, source: 'user-default' }
  return { agentId: agent.agentId, source: 'runtime' }
}
