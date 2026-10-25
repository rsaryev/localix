import type { StoreProvider } from '@localixai/store'

import type { SemanticQuery } from '@localixai/mini-app-sdk/backend'
import { createSearchProviderRegistry } from '../../agent-core/search/provider'
import { createSearchService } from '../../search/service'
import { createStoreIndexRepository } from '../index-repository'
import { openStoreIndexDatabase } from '../index-repository-open'
import { createStoreService } from '../service'
import { TEST_NOW } from './index'

/**
 * A Store as `bootstrap/` builds one, in memory: its index, and the global search service with
 * the Store's provider registered in it, so a search takes the path a real one takes. `meaning`
 * stands in for the semantic index: the matches a query's meaning finds, by listing key.
 */
export function makeStore(
  providers: readonly StoreProvider[],
  opts: {
    meaning?: (text: string) => Array<{ key: string; z: number }>
    projectWords?: string[]
    resyncMeaning?: () => void
    meaningChanged?: (keys: string[]) => void
  } = {},
) {
  const { db, close } = openStoreIndexDatabase(':memory:')
  const index = createStoreIndexRepository(db)
  const registry = createSearchProviderRegistry()
  const semantic = opts.meaning
  const search = createSearchService({
    registry,
    ...(semantic
      ? {
          strategy: {
            note: () => ({ mode: 'hybrid' as const }),
            queryFor: (_userId: string, text: string): SemanticQuery => ({
              zGate: 2,
              similar: async () =>
                semantic(text).map((match) => ({
                  ...match,
                  chunk: 0,
                  excerpt: '',
                  gate: 2,
                  cosine: 0.5,
                  scope: null,
                })),
            }),
          },
        }
      : {}),
  })
  const store = createStoreService({
    providers,
    index,
    search: (userId, request) => search.search(userId, request),
    now: () => TEST_NOW,
    ...(opts.projectWords ? { projectWords: async () => new Set(opts.projectWords) } : {}),
    ...(opts.resyncMeaning ? { resyncMeaning: opts.resyncMeaning } : {}),
    ...(opts.meaningChanged ? { meaningChanged: opts.meaningChanged } : {}),
  })
  registry.register(store.searchProvider)
  return { store, search, index, close }
}
