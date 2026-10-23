/**
 * DATABASE search provider (agent-core search) — matches saved connection names +
 * dialect over the database service's per-user registry. Hit ids reuse the `localix://resource/db/<id>`
 * resource grammar so a result opens the connection. `eager` (a cheap per-user list;
 * live schema/table introspection is a separate lazy concern, not done here).
 */
import type { SearchHit, SearchProvider } from '@localixai/mini-app-sdk/backend'
import { bestFieldScore, buildResourceUri } from '@localixai/mini-app-sdk/backend'
import { DATABASE_RESOURCE_PROVIDER } from './resource-provider-id'

export interface DbSearchRow {
  id: string
  name: string
  dialect: string
}

export interface DbSearchPort {
  listConnections(userId: string): Promise<DbSearchRow[]>
}

export function createDatabaseSearchProvider(port: DbSearchPort): SearchProvider {
  return {
    id: 'database:search',
    title: 'Databases',
    tier: 'eager',
    icon: 'database',
    async search(userId, query) {
      const rows = await port.listConnections(userId).catch(() => [] as DbSearchRow[])
      const hits: SearchHit[] = []
      for (const c of rows) {
        const score = bestFieldScore([c.name, c.dialect], query.text)
        if (score <= 0) continue
        hits.push({
          id: buildResourceUri(DATABASE_RESOURCE_PROVIDER, [c.id]),
          domain: 'database:search',
          title: c.name,
          subtitle: c.dialect,
          icon: 'database',
          score,
        })
      }
      return hits
    },
  }
}
