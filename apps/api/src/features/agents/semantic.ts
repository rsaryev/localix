/**
 * Agents in the semantic index: their own collection, so a search for agents weighs
 * agents only. Listed whole for the workspace owner across scopes (`list-source.ts`) and
 * reconciled when the kind changes.
 */
import type { CoreRefs } from '../changes/core-entities'
import type { EntityRef } from '../changes/contracts'
import { catalogKey, createScopedCatalogSource } from '../embeddings/list-source'
import type { SemanticTarget } from '../embeddings/targets'
import type { AgentsService } from './service'

export const AGENTS_COLLECTION = 'agents'

export const agentsSemanticTarget: SemanticTarget<EntityRef<CoreRefs, 'agent'>> = {
  collection: AGENTS_COLLECTION,
  keyOf: (ref) => catalogKey(ref.scope, ref.id),
}

export function createAgentsSemanticSource(deps: {
  owner: string
  projects: () => Promise<readonly string[]>
  listAgents: AgentsService['listAgents']
}) {
  return createScopedCatalogSource({
    collection: AGENTS_COLLECTION,
    label: 'Agents',
    // 2: an agent's instructions are embedded with its description.
    version: 2,
    owner: deps.owner,
    projects: deps.projects,
    list: async (projectId) =>
      (await deps.listAgents(deps.owner, { projectId })).map((a) => ({
        name: a.record.handle,
        title: a.record.label || a.record.handle,
        description: a.record.description ?? '',
        body: a.record.instructions,
      })),
  })
}
