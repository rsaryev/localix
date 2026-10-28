import type { CatalogModel } from '@localixai/agent/catalog'
import type { ModelPickerRequest } from '@/shared/lib/modelPickerBus'
import type { ReasoningEffort } from '../../model/reasoning'
import { ModelPickerShell } from './model-select/ModelPickerShell'
import type { useConnections } from './useConnections'
import { useMemo } from 'react'
import { useAgents } from '@/shared/contrib/useAgents'
import { conversationAgentRow } from './model-select/agentRow'
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
  /** The conversation's agent, its route resolved by the server. */
  agent?: SessionAgentRoute | null
  /** Scope for resolving the agent's display name ('' = global). */
  agentScope?: string
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
  agent,
  agentScope = '',
}: ModelPickerDrawerProps) {
  // Registry names live behind the lazy drawer on purpose: a chat that never opens the picker
  // should not pay for a roster fetch.
  const { agents } = useAgents(agentScope)
  const row = useMemo(
    () =>
      conversationAgentRow(
        agent,
        agents.find((candidate) => candidate.record.id === agent?.agentId)?.record,
      ),
    [agent, agents],
  )

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
      agent={row}
      // Picking does NOT close the picker. Choosing a model is rarely one decision: the agent and
      // the background workloads sit in the same column. The choice takes effect immediately
      // either way; closing is the reader's own gesture.
      onPickSessionModel={onPickSessionModel}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={onReasoningEffortChange}
      initialQuery={seed?.query}
      initialProviderId={seed?.providerId}
      initialConnectionId={seed?.connectionId}
      initialWorkload={seed?.workload}
    />
  )
}
