/**
 * PLUGINS search provider (agent-core search) — matches plugin name/displayName +
 * description over the plugin catalog. Every hit addresses one row in its exact scope.
 */
import type { SearchProvider } from '../agent-core/search/provider'
import { catalogHits } from '../search/catalog-hybrid'
import { PLUGINS_COLLECTION } from './semantic'
import { settingsEntityUiUri } from '@localixai/uri'

export interface PluginSearchRow {
  name: string
  displayName?: string
  description: string
}

export interface PluginsSearchPort {
  listPlugins(userId: string, projectId?: string | null): Promise<PluginSearchRow[]>
}

export function createPluginsSearchProvider(port: PluginsSearchPort): SearchProvider {
  return {
    id: 'plugins',
    title: 'Plugins',
    tier: 'eager',
    icon: 'plugin',
    async search(userId, query) {
      const rows = await port
        .listPlugins(userId, query.projectId)
        .catch(() => [] as PluginSearchRow[])
      return catalogHits(query, {
        collection: PLUGINS_COLLECTION,
        rows,
        nameOf: (p) => p.name,
        fields: (p) => [p.displayName, p.name, p.description],
        hit: (p, score) => ({
          id: settingsEntityUiUri('plugins', 'plugin', p.name, query.projectId ?? ''),
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
