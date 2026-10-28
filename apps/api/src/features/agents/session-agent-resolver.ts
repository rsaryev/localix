/**
 * WHICH AGENT MAY BE USED IN A SESSION.
 *
 * Two questions, asked in order, because they fail differently. "Does this agent exist and is it
 * enabled here" is about the registry; "may it be invoked THIS way" is about its invocation policy.
 * An agent can pass the first and fail the second: an agent the user or an extension owns that must
 * not be talked to says so by denying `invocation:chat`, and stays enabled for delegation.
 *
 * Both are asked before the session exists rather than at the first turn. Choosing an agent that
 * may never speak produces a conversation whose first reply is a policy error in that agent's own
 * voice, as if the refusal were its answer. Observed exactly that before this check existed.
 *
 * `host` absent means the caller is not asking a conversational question: an engine creating its
 * own worker session uses the agent it dispatched, whose `chat` policy is beside the point.
 */
import type { AgentDefinition } from '@localixai/agent/agents'

type ResolvedAgent = Pick<AgentDefinition, 'id' | 'name'>

/**
 * An id, or a name when choosing someone new. Stated here rather than imported from the chat
 * feature that asks: this feature answers the question and must not depend on the host asking it
 * (`features/host-boundaries.test.ts`).
 */
export type AgentSelection = { agentId: string } | { name: string; agentId?: undefined }

export interface SessionAgentRegistry {
  resolveEnabledAgent: (
    userId: string,
    agentId: string,
    projectId: string | null,
  ) => Promise<ResolvedAgent | null>
  selectEnabledAgent: (
    userId: string,
    name: string,
    projectId: string | null,
  ) => Promise<ResolvedAgent | null>
  resolveInvocableAgent: (
    userId: string,
    agentId: string,
    host: string,
    projectId?: string | null,
  ) => Promise<unknown>
}

export function createSessionAgentResolver(agents: SessionAgentRegistry) {
  return async (
    userId: string,
    selection: AgentSelection,
    projectId: string | null,
    host?: string,
  ): Promise<ResolvedAgent | null> => {
    const chosen =
      selection.agentId !== undefined
        ? await agents.resolveEnabledAgent(userId, selection.agentId, projectId)
        : await agents.selectEnabledAgent(userId, selection.name, projectId)
    if (!chosen || !host) return chosen
    return (await agents.resolveInvocableAgent(userId, chosen.id, host, projectId)) ? chosen : null
  }
}
