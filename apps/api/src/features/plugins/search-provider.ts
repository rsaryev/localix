/**
 * PLUGINS search provider (agent-core search) — matches plugin name/displayName +
 * description over the plugin catalog. Every hit addresses one row in its exact scope.
 */
import type { SearchHit, SearchProvider } from '../agent-core/search/provider'
import { bestFieldScore } from '../agent-core/search/match'
import { settingsEntityUiUri } from '@localixai/plugin-sdk/navigation'

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
      const hits: SearchHit[] = []
      for (const p of rows) {
        const score = bestFieldScore([p.displayName, p.name, p.description], query.text)
        if (score <= 0) continue
        hits.push({
          id: settingsEntityUiUri('plugins', 'plugin', p.name, query.projectId ?? ''),
          domain: 'plugins',
          title: p.displayName || p.name,
          subtitle: p.description,
          icon: 'plugin',
          score,
        })
      }
      return hits
    },
  }
}
