import type { CatalogModel } from '@localixai/agent/catalog'
import type { ModelPickerRequest } from '@/shared/lib/modelPickerBus'
import type { ReasoningEffort } from '../../model/reasoning'
import { ModelPickerShell } from './model-select/ModelPickerShell'
import type { useConnections } from './useConnections'
import { useMemo } from 'react'
import { useAgents } from '@/features/settings/model/useAgents'
import type { ParticipantRow } from './model-select/ModelTaskColumn'
import type { SessionAgentRoute } from '@/shared/api/contracts'

interface ModelPickerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  seed: (ModelPickerRequest & { revision: number }) | null
  models: CatalogModel[]
  connectionsState: ReturnType<typeof useConnections>
  sessionModelId: string
  sessionConnectionId: string | null
  onPickSessionModel: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
  /** The conversation's party, routes resolved by the server, in join order. */
  participants?: readonly SessionAgentRoute[]
  /** Scope for resolving participant display names ('' = global). */
  participantScope?: string
  reasoningEffort: ReasoningEffort
  onReasoningEffortChange: (effort: ReasoningEffort, agentId?: string) => void
}

/**
 * Interaction-only model picker boundary. The parent deliberately owns the
 * always-visible trigger so importing Vaul cannot pull it into the startup graph.
 * @public
 */
export function ModelPickerDrawer({
  open,
  onOpenChange,
  seed,
  models,
  connectionsState,
  sessionModelId,
  sessionConnectionId,
  onPickSessionModel,
  reasoningEffort,
  onReasoningEffortChange,
  participants,
  participantScope = '',
}: ModelPickerDrawerProps) {
  // Registry names live behind the lazy drawer on purpose: the composer shows a party without
  // them, and a chat that never opens the picker should not pay for a roster fetch.
  const { agents } = useAgents(participantScope)
  const byId = useMemo(() => new Map(agents.map((agent) => [agent.record.id, agent])), [agents])
  const named = useMemo<ParticipantRow[]>(() => {
    return (participants ?? []).map((member) => {
      const entry = byId.get(member.agentId)
      const record = entry?.record
      return {
        agentId: member.agentId,
        ...(record?.limits?.maxTurns ? { maxTurnsLimit: record.limits.maxTurns } : {}),
        handle: member.handle,
        // A handle the registry cannot resolve still gets a row: the conversation is with
        // someone, and hiding them would make the picker disagree with the transcript.
        ...(record?.label ? { label: record.label } : {}),
        ...(record?.modelPreference?.model
          ? { inheritedLabel: `Use ${record.modelPreference?.model}` }
          : {}),
        // What this member actually runs on, already resolved through the chain by the server —
        // its level included, so the picker answers for the member it is pointed at instead of
        // repeating the conversation's.
        route: {
          providerConnectionId: member.providerConnectionId,
          modelId: member.modelId,
          ...(member.reasoningEffort ? { reasoningEffort: member.reasoningEffort } : {}),
        },
        ...(member.modelOrigin ? { modelOrigin: member.modelOrigin } : {}),
      }
    })
  }, [byId, participants])

  return (
    <ModelPickerShell
      open={open}
      onOpenChange={onOpenChange}
      title="Choose model"
      key={seed?.revision ?? 'manual'}
      models={models}
      connectionsState={connectionsState}
      sessionModelId={sessionModelId}
      sessionConnectionId={sessionConnectionId}
      participants={named}
      // Picking does NOT close the picker. Choosing a model is rarely one decision: a room has
      // a row per participant and the background workloads sit in the same column, so closing
      // on each pick made configuring four members four open-navigate-pick-close rounds. The
      // choice takes effect immediately either way; closing is the reader's own gesture.
      onPickSessionModel={onPickSessionModel}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={onReasoningEffortChange}
      initialQuery={seed?.query}
      initialProviderId={seed?.providerId}
      initialConnectionId={seed?.connectionId}
    />
  )
}
