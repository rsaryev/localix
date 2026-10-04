/**
 * MODELS search provider (agent-core search) — matches model id/name over the resolved
 * runtime adapter catalog. Models are configured through the Providers settings
 * tab, so hits use that canonical surface URI.
 */
import type { SearchHit, SearchProvider } from '../agent-core/search/provider'
import { bestFieldScore } from '../agent-core/search/match'
import { localixResourceUri, settingsUiUri } from '@localixai/plugin-sdk/navigation'

export interface ModelSearchRow {
  id: string
  name: string
}

export interface ModelsSearchPort {
  listModels(): Promise<ModelSearchRow[]>
}

const MODELS_CAP = 40

export function createModelsSearchProvider(port: ModelsSearchPort): SearchProvider {
  return {
    id: 'models',
    title: 'Models',
    tier: 'eager',
    icon: 'provider',
    async search(_userId, query) {
      const models = await port.listModels().catch(() => [] as ModelSearchRow[])
      const hits: SearchHit[] = []
      for (const m of models) {
        const score = bestFieldScore([m.name, m.id], query.text)
        if (score <= 0) continue
        hits.push({
          id: localixResourceUri('model', [m.id]),
          uri: settingsUiUri('providers', { scope: query.projectId ?? '' }),
          domain: 'models',
          title: m.name,
          subtitle: m.id,
          icon: 'provider',
          score,
        })
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, MODELS_CAP)
    },
  }
}
