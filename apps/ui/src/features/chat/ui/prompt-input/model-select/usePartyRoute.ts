import { useCallback, useMemo } from 'react'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { ApplyPartyRoute } from '../../../model/sessionPartyRoute'
import type { ParticipantRow } from './ModelTaskColumn'
import { isAllChosen, partyStatusText, summarizeParty } from './partyRoute'
import { resolveLiveTaskModel } from './taskReasoning'

/**
 * Everything the model browser needs for its "All agents" target: the summary of every listed
 * agent, the row the column draws, and the two writes it makes through the same
 * `onApplyPartyRoute` port — each naming every listed agent, invited or not.
 */
export function usePartyRoute({
  participants,
  sessionConnectionId,
  models,
  connections,
  onApplyPartyRoute,
}: {
  participants: readonly ParticipantRow[]
  sessionConnectionId: string | null
  models: readonly CatalogModel[]
  connections: readonly { id: string; providerId: string }[]
  onApplyPartyRoute?: ApplyPartyRoute
}) {
  const summary = useMemo(
    () =>
      summarizeParty(
        participants,
        sessionConnectionId,
        (slot) => resolveLiveTaskModel(models, connections, slot) !== null,
      ),
    [connections, models, participants, sessionConnectionId],
  )
  const column = useMemo(() => {
    // Always offered where it can be written — one agent included.
    if (!onApplyPartyRoute || summary.size === 0) return undefined
    // The one model the routed members share, named the way their own rows name it.
    const first = participants.find((member) => member.route?.modelId)?.route
    const live = first
      ? resolveLiveTaskModel(models, connections, {
          providerConnectionId: first.providerConnectionId ?? sessionConnectionId ?? '',
          modelId: first.modelId,
        })
      : null
    return {
      status: partyStatusText(summary, live?.model.name ?? first?.modelId ?? null),
      mixed:
        summary.models > 1 || summary.levels > 1 || summary.unset > 0 || summary.unavailable > 0,
      chosen: isAllChosen(summary),
    }
  }, [connections, models, onApplyPartyRoute, participants, sessionConnectionId, summary])
  const agentIds = useMemo(() => participants.map((member) => member.agentId), [participants])
  const partyRoute = useCallback(() => summary.slot, [summary])
  const onPickPartyModel = useCallback(
    (connectionId: string, modelId: string, reasoningEffort: ReasoningEffort) =>
      onApplyPartyRoute?.(
        { providerConnectionId: connectionId, modelId, reasoningEffort },
        agentIds,
      ),
    [agentIds, onApplyPartyRoute],
  )
  const onPartyReasoningChange = useCallback(
    (reasoningEffort: ReasoningEffort) => void onApplyPartyRoute?.({ reasoningEffort }, agentIds),
    [agentIds, onApplyPartyRoute],
  )
  return { summary, column, partyRoute, onPickPartyModel, onPartyReasoningChange }
}
