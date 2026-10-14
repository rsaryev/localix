/**
 * MCP search provider (agent-core search) — matches server name + description over the
 * per-user MCP server records (NEVER connects/probes). Every hit addresses one
 * row in its exact scope.
 */
import type { SearchHit, SearchProvider } from '../agent-core/search/provider'
import { bestFieldScore } from '../agent-core/search/match'
import { settingsEntityUiUri } from '@localixai/plugin-sdk/navigation'

export interface McpSearchRow {
  name: string
  description: string
}

export interface McpSearchPort {
  listServers(userId: string, projectId?: string | null): Promise<McpSearchRow[]>
}

export function createMcpSearchProvider(port: McpSearchPort): SearchProvider {
  return {
    id: 'mcp',
    title: 'MCP',
    tier: 'eager',
    icon: 'mcp',
    async search(userId, query) {
      const rows = await port.listServers(userId, query.projectId).catch(() => [] as McpSearchRow[])
      const hits: SearchHit[] = []
      for (const s of rows) {
        const score = bestFieldScore([s.name, s.description], query.text)
        if (score <= 0) continue
        hits.push({
          id: settingsEntityUiUri('mcp', 'mcp', s.name, query.projectId ?? ''),
          domain: 'mcp',
          title: s.name,
          subtitle: s.description,
          icon: 'mcp',
          score,
        })
      }
      return hits
    },
  }
}
