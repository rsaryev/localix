/**
 * WHICH AGENT MAY BE SEATED IN A SESSION.
 *
 * Two questions, asked in order, because they fail differently. "Does this agent exist and is it
 * enabled here" is about the registry; "may it be invoked THIS way" is about its invocation policy.
 * An agent can pass the first and fail the second: an agent the user or an extension owns that must
 * not be talked to says so by denying `invocation:chat`, and stays enabled for delegation.
 *
 * Both are asked before the seat exists rather than at the first turn. Seating an agent that may
 * never speak produces a conversation whose first reply is a policy error in that agent's own
 * voice, as if the refusal were its answer — and in a group the other members then read it as a
 * colleague's contribution. Observed exactly that before this check existed.
 *
 * `host` absent means the caller is not asking a conversational question: an engine creating its
 * own worker session seats the agent it dispatched, whose `chat` policy is beside the point.
 */
import type { AgentDefinition } from '@localixai/agent/agents'

type SeatedAgent = Pick<AgentDefinition, 'id' | 'handle'>

/**
 * An id, or a handle when choosing someone new. Stated here rather than imported from the chat
 * feature that asks: this feature answers the question and must not depend on the host asking it
 * (`features/host-boundaries.test.ts`).
 */
export type SeatSelection = { agentId: string } | { handle: string; agentId?: undefined }

export interface SessionSeatAgents {
  resolveEnabledAgent: (
    userId: string,
    agentId: string,
    projectId: string | null,
  ) => Promise<SeatedAgent | null>
  selectEnabledAgent: (
    userId: string,
    handle: string,
    projectId: string | null,
  ) => Promise<SeatedAgent | null>
  resolveInvocableAgent: (
    userId: string,
    agentId: string,
    host: string,
    projectId?: string | null,
  ) => Promise<unknown>
}

export function createSessionSeatResolver(agents: SessionSeatAgents) {
  return async (
    userId: string,
    selection: SeatSelection,
    projectId: string | null,
    host?: string,
  ): Promise<SeatedAgent | null> => {
    const chosen =
      selection.agentId !== undefined
        ? await agents.resolveEnabledAgent(userId, selection.agentId, projectId)
        : await agents.selectEnabledAgent(userId, selection.handle, projectId)
    if (!chosen || !host) return chosen
    return (await agents.resolveInvocableAgent(userId, chosen.id, host, projectId)) ? chosen : null
  }
}
