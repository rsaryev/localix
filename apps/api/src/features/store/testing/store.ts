import type { StoreProvider } from '@localixai/store'

import type { SemanticQuery } from '@localixai/mini-app-sdk/backend'
import { createSearchProviderRegistry } from '@localixai/mini-app-sdk/backend'
import { createSearchService, type SearchStrategyPort } from '../../search/service'
import { createStoreIndexRepository } from '../index-repository'
import { openStoreIndexDatabase } from '../index-repository-open'
import { createStoreService, type StoreContextPort } from '../service'
import type { StoreItemMeaningPort } from '../service-types'
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
    /** The open project's root names and dependencies, as they are written. */
    projectFacts?: { files: string[]; dependencies: string[] }
    resyncMeaning?: () => void
    meaningChanged?: (keys: string[]) => void
    /** What the working set says, as Context Fabric would admit it. */
    context?: StoreContextPort
    schedule?: (work: () => void) => () => void
    /** What the stored vectors of these installed listings are near, as the semantic index says. */
    itemMeaning?: (
      members: ReadonlyArray<{ key: string; weight: number }>,
    ) => Array<{ key: string; z: number }>
    /** A real semantic index instead of `meaning` and `itemMeaning` (the offline evaluation). */
    semantic?: { strategy: SearchStrategyPort; similarToItems: StoreItemMeaningPort }
    /** The clock the Store reads; `TEST_NOW` when absent. */
    now?: () => number
  } = {},
) {
  const { db, close } = openStoreIndexDatabase(':memory:')
  const index = createStoreIndexRepository(db)
  const registry = createSearchProviderRegistry()
  const semantic = opts.meaning
  const search = createSearchService({
    registry,
    ...(opts.semantic ? { strategy: opts.semantic.strategy } : {}),
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
    now: opts.now ?? (() => TEST_NOW),
    ...(opts.projectWords ? { projectWords: async () => new Set(opts.projectWords) } : {}),
    ...(opts.projectFacts ? { projectFacts: async () => opts.projectFacts! } : {}),
    ...(opts.resyncMeaning ? { resyncMeaning: opts.resyncMeaning } : {}),
    ...(opts.meaningChanged ? { meaningChanged: opts.meaningChanged } : {}),
    ...(opts.context ? { workingContext: opts.context } : {}),
    ...(opts.semantic ? { similarToItems: opts.semantic.similarToItems } : {}),
    ...(opts.itemMeaning
      ? {
          similarToItems: async (
            _userId: string,
            members: ReadonlyArray<{ key: string; weight: number }>,
          ) => opts.itemMeaning!(members).map((match) => ({ ...match, gate: 2 })),
        }
      : {}),
    ...(opts.schedule ? { scheduleRecommendation: opts.schedule } : {}),
  })
  registry.register(store.searchProvider)
  return { store, search, index, close }
}
