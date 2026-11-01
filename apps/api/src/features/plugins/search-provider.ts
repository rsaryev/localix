/**
 * PLUGINS search provider (agent-core search) — matches plugin name/displayName +
 * description over the plugin catalog. Every hit opens the plugin's Store page.
 *
 * Its shape is the search registry's provider, checked where the boot registers it: plugins name
 * nothing of the mini app side (X1), whose SDK owns that registry.
 */
import { catalogHits } from '../search/catalog-hybrid'
import { PLUGINS_COLLECTION } from './semantic'
import { capabilityUiUri } from '@localixai/uri'

export interface PluginSearchRow {
  name: string
  /** `<plugin>@<marketplace>`, how the Store lists it; absent for a folder dropped in. */
  source?: string
  displayName?: string
  description: string
}

export interface PluginsSearchPort {
  listPlugins(userId: string, projectId?: string | null): Promise<PluginSearchRow[]>
}

type CatalogQuery = Parameters<typeof catalogHits>[0]

export function createPluginsSearchProvider(port: PluginsSearchPort) {
  return {
    id: 'plugins',
    title: 'Plugins',
    tier: 'eager' as const,
    icon: 'plugin',
    async search(userId: string, query: CatalogQuery) {
      const rows = await port
        .listPlugins(userId, query.projectId)
        .catch(() => [] as PluginSearchRow[])
      return catalogHits(query, {
        collection: PLUGINS_COLLECTION,
        rows,
        nameOf: (p) => p.name,
        fields: (p) => [p.displayName, p.name, p.description],
        hit: (p, score) => ({
          id: capabilityUiUri({ kind: 'plugin', id: p.source ?? p.name, scope: '' }),
          domain: 'plugins',
          title: p.displayName || p.name,
          subtitle: p.description,
          icon: 'plugin',
          score,
        }),
      })
    },
  }
}
