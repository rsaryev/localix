import { createStoreIndexRepository } from './index-repository'
import { openStoreIndexDatabase } from './index-repository-open'
import { createStoreService, type StoreService } from './service'

/** A Store with no providers, for a harness that mounts the routes without one. */
export function createEmptyStoreService(): StoreService {
  return createStoreService({
    providers: [],
    index: createStoreIndexRepository(openStoreIndexDatabase(':memory:').db),
    search: async () => ({ hits: [], strategy: { mode: 'lexical' } }),
  })
}
