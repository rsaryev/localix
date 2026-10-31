/**
 * MCP search provider (agent-core search) — matches server name + description over the
 * per-user MCP server records (NEVER connects/probes). Every hit addresses one
 * row in its exact scope.
 */
import type { SearchProvider } from '@localixai/mini-app-sdk/backend'
import { catalogHits } from '../search/catalog-hybrid'
import { MCP_COLLECTION } from './semantic'
import { capabilityUiUri } from '@localixai/mini-app-sdk/navigation'

export interface McpSearchRow {
  name: string
  description: string
  /** The project a project-scoped item belongs to; empty or absent for a personal one. */
  projectId?: string | null
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
      return catalogHits(query, {
        collection: MCP_COLLECTION,
        rows,
        nameOf: (s) => s.name,
        fields: (s) => [s.name, s.description],
        hit: (s, score) => ({
          id: capabilityUiUri({ kind: 'mcp', id: s.name, scope: s.projectId ?? '' }),
          domain: 'mcp',
          title: s.name,
          subtitle: s.description,
          icon: 'mcp',
          score,
        }),
      })
    },
  }
}
