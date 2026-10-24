import { join } from 'node:path'

import type { StoreProvider } from '@localixai/store'

import { createMiniAppStoreProvider } from '../features/mini-apps/store-provider'
import type { createMiniAppService } from '../features/mini-apps/service'
import type { SemanticService } from '../features/embeddings/service'
import type { RealtimeResource } from '../features/realtime/resources'
import type { SearchService } from '../features/search/service'
import { createStoreIndexRepository } from '../features/store/index-repository'
import { openStoreIndexDatabase } from '../features/store/index-repository-open'
import { createProjectSignals } from '../features/store/project-signals'
import { createStoreSemanticSource } from '../features/store/semantic'
import { STORE_COLLECTION } from '../features/store/search-provider'
import { createStoreService, type StoreService } from '../features/store/service'
import { localixHome } from '../lib/env'

/** The Store index's file: derived, so it lives with the caches, not beside the database. */
export const storeIndexFile = (home = localixHome()) => join(home, 'cache', 'store-index.sqlite')

/**
 * The Store and its providers (`docs/internals/store.md`, "How it works"): each owner builds the
 * provider for its package kind, and the Store gets the list (A4). The Store imports no owner. It
 * asks the global search service, built later, through `connectSearch`; its own `store` provider
 * goes into that service's registry, and its listings into a semantic collection of their own.
 */
export function createStorePhase(deps: {
  miniAppService: ReturnType<typeof createMiniAppService>
  /** Further providers (plugins), built by their owners' phases. */
  providers?: readonly StoreProvider[]
  semanticService?: Pick<SemanticService, 'registerSource' | 'resync'>
  resolveProjectCwd: (userId: string, projectId: string) => Promise<string | null>
  owner: string
  /** The index file; `:memory:` in a harness. */
  indexFile?: string
}): { storeService: StoreService; connectSearch(search: Pick<SearchService, 'search'>): void } {
  const { miniAppService } = deps
  const { db } = openStoreIndexDatabase(deps.indexFile ?? storeIndexFile())
  const index = createStoreIndexRepository(db)
  let search: Pick<SearchService, 'search'> | null = null
  const signals = createProjectSignals({ projectDir: deps.resolveProjectCwd })
  const storeService = createStoreService({
    providers: [
      createMiniAppStoreProvider({
        store: miniAppService.store,
        catalogs: miniAppService.catalogs,
        apps: miniAppService,
      }),
      ...(deps.providers ?? []),
    ],
    index,
    search: async (userId, request) => {
      if (!search) throw new Error('The global search service is not built yet')
      return search.search(userId, request)
    },
    projectWords: (userId, projectId) => signals.of(userId, projectId),
    ...(deps.semanticService
      ? { resyncMeaning: () => void deps.semanticService!.resync(STORE_COLLECTION).catch(() => {}) }
      : {}),
  })
  deps.semanticService?.registerSource(createStoreSemanticSource({ index, owner: deps.owner }))
  return {
    storeService,
    connectSearch(service) {
      search = service
    },
  }
}

/**
 * A poke the relay sends for an owner's change notice: when it names the Store, the Store's index
 * is out of date too, so it is synced again (a removal in Settings, a catalog added).
 */
export function invalidateStoreOn(
  store: Pick<StoreService, 'invalidate'>,
  publish: (userId: string, resources: RealtimeResource[]) => void,
) {
  return (userId: string, resources: RealtimeResource[]) => {
    if (resources.includes('store')) store.invalidate()
    publish(userId, resources)
  }
}
