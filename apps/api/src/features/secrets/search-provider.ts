/**
 * SECRETS search provider (agent-core search) — matches secret KEYS (values are
 * write-only and never surfaced). Every hit deep-links to the dedicated Vault
 * workspace and selects its item. `eager` (a cheap metadata-only list).
 */
import type { SearchHit, SearchProvider } from '@localixai/mini-app-sdk/backend'
import { bestFieldScore } from '@localixai/mini-app-sdk/backend'
import { vaultItemResourceUri } from './resource-provider'

export interface SecretsSearchPort {
  listItems(userId: string): Promise<Array<{ key: string; label: string; type: string }>>
}

export function createSecretsSearchProvider(port: SecretsSearchPort): SearchProvider {
  return {
    id: 'secrets',
    title: 'Secrets',
    tier: 'eager',
    icon: 'key',
    async search(userId, query) {
      const items = await port.listItems(userId).catch(() => [])
      const hits: SearchHit[] = []
      for (const item of items) {
        const score = bestFieldScore([item.key, item.label, item.type], query.text)
        if (score <= 0) continue
        hits.push({
          id: vaultItemResourceUri(item.key),
          domain: 'secrets',
          title: item.label,
          subtitle: `${item.type} · ${item.key}`,
          icon: 'key',
          score,
        })
      }
      return hits
    },
  }
}
