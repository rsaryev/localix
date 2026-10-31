import { localixUiUri } from '@localixai/uri'
import type { SearchProvider } from '@localixai/mini-app-sdk/backend'
import { catalogHits } from '../search/catalog-hybrid'
import { AGENTS_COLLECTION } from './semantic'

export interface AgentSearchRow {
  /** The agent id: the Store lists an agent under it. */
  id: string
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
          // An agent's page is its Store page; there is no Settings page of agents any more.
          id: localixUiUri('work-item', ['store'], { kind: 'agent', id: agent.id }),
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
