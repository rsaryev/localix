import { createMiniAppStoreProvider } from '../features/mini-apps/store-provider'
import type { createMiniAppService } from '../features/mini-apps/service'
import { createStoreService, type StoreService } from '../features/store/service'
import type { RealtimeResource } from '../features/realtime/resources'

/**
 * The Store and its providers (`docs/internals/store.md`, "How it works"): each owner builds the
 * provider for its package kind, and the Store gets the list (A4). The Store imports no owner.
 */
export function createStorePhase(deps: {
  miniAppService: ReturnType<typeof createMiniAppService>
}): StoreService {
  const { miniAppService } = deps
  return createStoreService({
    providers: [
      createMiniAppStoreProvider({
        store: miniAppService.store,
        catalogs: miniAppService.catalogs,
        apps: miniAppService,
      }),
    ],
  })
}

/**
 * A poke the relay sends for an owner's change notice: when it names the Store, the Store's index
 * is out of date too, so it is rebuilt on the next read (a removal in Settings, a catalog added).
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
