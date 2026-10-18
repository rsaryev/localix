/**
 * MCP servers in the semantic index: their own collection, so a search for MCP servers weighs
 * MCP servers only. Listed whole for the workspace owner across scopes (`list-source.ts`) and
 * reconciled when the kind changes.
 */
import type { CoreRefs } from '../changes/core-entities'
import type { EntityRef } from '../changes/contracts'
import { catalogKey, createScopedCatalogSource } from '../embeddings/list-source'
import type { SemanticTarget } from '../embeddings/targets'
import type { McpService } from './service'

export const MCP_COLLECTION = 'capabilities.mcp'

export const mcpSemanticTarget: SemanticTarget<EntityRef<CoreRefs, 'mcp'>> = {
  collection: MCP_COLLECTION,
  keyOf: (ref) => catalogKey(ref.scope, ref.id),
}

export function createMcpSemanticSource(deps: {
  owner: string
  projects: () => Promise<readonly string[]>
  listServers: McpService['listServers']
}) {
  return createScopedCatalogSource({
    collection: MCP_COLLECTION,
    label: 'MCP servers',
    version: 1,
    owner: deps.owner,
    projects: deps.projects,
    list: async (projectId) =>
      (await deps.listServers(deps.owner, { projectId })).servers.map((s) => ({
        name: s.name,
        title: s.name,
        description: s.description ?? '',
      })),
  })
}
