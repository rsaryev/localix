/**
 * The conversation's agent's model, for the picker's own row.
 *
 * The agent can hold a model with no connection of its own — that is what a model inherited
 * from the agent's card looks like, since a card names a provider and never the user's
 * credentials. The run resolves a live connection for such a model anyway, so the
 * conversation's connection stands in here, which is the one the picker would have offered.
 */
import type { ModelRoutingSlot } from './taskReasoning'
import type { ConversationAgentRow } from './ModelTaskColumn'

export function agentSlot(
  agent: ConversationAgentRow | undefined,
  /** Fallback credentials; see above. */
  sessionConnectionId: string | null,
): ModelRoutingSlot {
  if (!agent?.route?.modelId) return null
  return {
    providerConnectionId: agent.route.providerConnectionId ?? sessionConnectionId ?? '',
    modelId: agent.route.modelId,
    // The agent's own level travels with its model.
    ...(agent.route.reasoningEffort ? { reasoningEffort: agent.route.reasoningEffort } : {}),
  }
}
