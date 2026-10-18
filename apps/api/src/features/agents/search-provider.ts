import { settingsEntityUiUri } from '@localixai/plugin-sdk/navigation'
import type { SearchProvider } from '../agent-core/search/provider'
import { catalogHits } from '../search/catalog-hybrid'
import { AGENTS_COLLECTION } from './semantic'

export interface AgentSearchRow {
  name: string
  label?: string
  description: string
}

export interface AgentsSearchPort {
  listAgents(userId: string, projectId?: string | null): Promise<AgentSearchRow[]>
}

export function createAgentsSearchProvider(port: AgentsSearchPort): SearchProvider {
  return {
    id: 'agents',
    title: 'Agents',
    tier: 'eager',
    icon: 'agent',
    async search(userId, query) {
      const rows = await port
        .listAgents(userId, query.projectId)
        .catch(() => [] as AgentSearchRow[])
      return catalogHits(query, {
        collection: AGENTS_COLLECTION,
        rows,
        nameOf: (agent) => agent.name,
        fields: (agent) => [agent.label, agent.name, agent.description],
        hit: (agent, score) => ({
          id: settingsEntityUiUri('agents', 'agent', agent.name, query.projectId ?? ''),
          domain: 'agents',
          title: agent.label || agent.name,
          subtitle: agent.description,
          icon: 'agent',
          score,
        }),
      })
    },
  }
}
