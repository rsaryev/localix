import { useCallback, useMemo } from 'react'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { PartyRouteChoice } from '../../../model/sessionPartyRoute'
import type { ParticipantRow } from './ModelTaskColumn'
import { partyStatusText, PARTY_TARGET, showPartyRow, summarizeParty } from './partyRoute'
import type { PickerTarget } from './pickerTarget'
import { resolveLiveTaskModel } from './taskReasoning'

/**
 * Everything the model browser needs for its "All agents" target: the room's summary, the row
 * the column draws, and the two writes it makes through the same `onApplyPartyRoute` port.
 */
export function usePartyRoute({
  participants,
  sessionConnectionId,
  models,
  connections,
  taskKey,
  onApplyPartyRoute,
}: {
  participants: readonly ParticipantRow[]
  sessionConnectionId: string | null
  models: readonly CatalogModel[]
  connections: readonly { id: string; providerId: string }[]
  taskKey: PickerTarget
  onApplyPartyRoute?: (choice: PartyRouteChoice) => void | Promise<void>
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
    if (!showPartyRow(summary, taskKey === PARTY_TARGET, Boolean(onApplyPartyRoute)))
      return undefined
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
      mixed: summary.relevant,
    }
  }, [connections, models, onApplyPartyRoute, participants, sessionConnectionId, summary, taskKey])
  const partyRoute = useCallback(() => summary.slot, [summary])
  const onPickPartyModel = useCallback(
    (connectionId: string, modelId: string, reasoningEffort: ReasoningEffort) =>
      onApplyPartyRoute?.({ providerConnectionId: connectionId, modelId, reasoningEffort }),
    [onApplyPartyRoute],
  )
  const onPartyReasoningChange = useCallback(
    (reasoningEffort: ReasoningEffort) => void onApplyPartyRoute?.({ reasoningEffort }),
    [onApplyPartyRoute],
  )
  return { summary, column, partyRoute, onPickPartyModel, onPartyReasoningChange }
}
