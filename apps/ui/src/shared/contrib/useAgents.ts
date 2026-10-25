import type { AgentSummary } from '@/shared/api/contracts'
import { useCapabilitySnapshot } from '@/shared/contrib/useCapabilitySnapshot'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

export interface AgentsData {
  agents: AgentSummary[]
  loading: boolean
  error: string | null
}

/**
 * The agents a scope (project id, or '' for yours) can use, read from its capability document.
 * Agents are Claude Code files written and removed in the Store; this hook only reads them, and a
 * hidden work item does not fetch.
 */
export function useAgents(scope: string): AgentsData {
  const { snapshot, loading, error } = useCapabilitySnapshot(scope, useWorkItemVisible())
  return { agents: snapshot?.agents ?? [], loading, error }
}
