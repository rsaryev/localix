import { settingsEntityUiUri } from '@localixai/plugin-sdk/navigation'
import type { SearchHit, SearchProvider } from '../agent-core/search/provider'
import { bestFieldScore } from '../agent-core/search/match'

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
      const hits: SearchHit[] = []
      for (const agent of rows) {
        const score = bestFieldScore([agent.label, agent.name, agent.description], query.text)
        if (score <= 0) continue
        hits.push({
          id: settingsEntityUiUri('agents', 'agent', agent.name, query.projectId ?? ''),
          domain: 'agents',
          title: agent.label || agent.name,
          subtitle: agent.description,
          icon: 'agent',
          score,
        })
      }
      return hits
    },
  }
}
