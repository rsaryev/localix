/**
 * Plugins in the semantic index: their own collection, so a search for plugins weighs
 * plugins only. Listed whole for the workspace owner across scopes (`list-source.ts`) and
 * reconciled when the kind changes.
 */
import type { CoreRefs } from '../changes/core-entities'
import type { EntityRef } from '../changes/contracts'
import { catalogKey, createScopedCatalogSource } from '../embeddings/list-source'
import type { SemanticTarget } from '../embeddings/targets'
import type { PluginService } from './service-types'

export const PLUGINS_COLLECTION = 'capabilities.plugins'

export const pluginsSemanticTarget: SemanticTarget<EntityRef<CoreRefs, 'plugin'>> = {
  collection: PLUGINS_COLLECTION,
  keyOf: (ref) => catalogKey(ref.scope, ref.id),
}

export function createPluginsSemanticSource(deps: {
  owner: string
  projects: () => Promise<readonly string[]>
  listPlugins: PluginService['listPlugins']
}) {
  return createScopedCatalogSource({
    collection: PLUGINS_COLLECTION,
    label: 'Plugins',
    version: 1,
    owner: deps.owner,
    projects: deps.projects,
    list: async (projectId) =>
      (await deps.listPlugins(deps.owner, { projectId })).plugins.map((p) => ({
        name: p.name,
        title: p.displayName || p.name,
        description: p.description ?? '',
      })),
  })
}
