/**
 * ONE participant's model, for the picker's own row.
 *
 * The column used to ask a single question — "what is this conversation's model" — and print
 * the answer on every participant row, so a room of three showed one model three times whatever
 * each member was actually on. This answers per member instead.
 */
import type { ModelRoutingSlot } from './taskReasoning'
import type { ParticipantRow } from './ModelTaskColumn'

export function participantSlot(
  participants: readonly ParticipantRow[],
  agentId: string,
  /** Fallback credentials; see below. */
  sessionConnectionId: string | null,
): ModelRoutingSlot {
  const member = participants.find((row) => row.agentId === agentId)
  if (!member?.route?.modelId) return null
  // A member can hold a model with no connection of its own — that is what a model inherited
  // from the agent's card looks like, since a card names a provider and never the user's
  // credentials. The run resolves a live connection for such a model anyway, so the
  // conversation's connection stands in here, which is the one the picker would have offered.
  return {
    providerConnectionId: member.route.providerConnectionId ?? sessionConnectionId ?? '',
    modelId: member.route.modelId,
    // The member's own level travels with its model. Dropping it here is what made the picker
    // read the conversation's level for whoever was selected: open another member and it showed
    // the level just set for the previous one.
    ...(member.route.reasoningEffort ? { reasoningEffort: member.route.reasoningEffort } : {}),
  }
}
