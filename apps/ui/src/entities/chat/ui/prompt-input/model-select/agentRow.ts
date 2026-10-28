import type { SessionAgentRoute } from '@/shared/api/contracts'
import type { ConversationAgentRow } from './ModelTaskColumn'

/** The registry facts the agent's row shows: its name, turn ceiling and own model. */
export interface AgentRecord {
  maxTurns?: number
}

/**
 * The picker's row for the conversation's agent — one builder for the picker and `/model`, so
 * both name and route the agent the same way.
 *
 * The route is what the agent actually runs on, already resolved through the model chain by the
 * server, its level included.
 */
export function conversationAgentRow(
  agent: SessionAgentRoute | null | undefined,
  record: AgentRecord | undefined,
): ConversationAgentRow | undefined {
  if (!agent) return undefined
  return {
    agentId: agent.agentId,
    name: agent.name,
    ...(record?.maxTurns ? { maxTurnsLimit: record.maxTurns } : {}),
    route: {
      providerConnectionId: agent.providerConnectionId,
      modelId: agent.modelId,
      ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {}),
    },
    ...(agent.modelOrigin ? { modelOrigin: agent.modelOrigin } : {}),
  }
}
