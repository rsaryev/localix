import { recordCoreChanges } from '../changes/core-entities'
import { createMiniAppAutoUpdate } from './auto-update'
import { withCatalogPreview } from './catalog-preview'
import { createMiniAppCatalogs } from './catalogs'
import { createRecommendedInstalls } from './recommended'
import type { MiniAppServiceDeps } from './service'
import { createMiniAppStore } from './store'
import { builtInMiniAppSources } from './store-sources'

/**
 * The mini app service's store half: the catalogs (built in, then the person's), the store that
 * installs and updates from them, and the one-time install of the apps the Localix catalog
 * recommends. An install is announced (`mini-app` notice); a fresh one is enabled, since choosing
 * it in the store is the person's yes to run it, and an update keeps their decision.
 */
export function createMiniAppStoreParts(
  deps: MiniAppServiceDeps,
  setEnabled: (userId: string, input: { name: string; enabled: boolean }) => Promise<void>,
) {
  const catalogList = createMiniAppCatalogs({
    db: deps.db,
    builtIn: deps.storeSources ?? builtInMiniAppSources,
  })
  const autoUpdate = createMiniAppAutoUpdate({ db: deps.db })
  const store = createMiniAppStore({
    homeDir: deps.homeDir,
    sources: () => catalogList.sources(),
    pinKey: (url, key) => catalogList.pinKey(url, key),
    linkedKeys: catalogList.linkedKeys,
    autoUpdateOff: () => autoUpdate.off(),
    onInstalled: async (name, { fresh, userId }) => {
      if (fresh && userId) await setEnabled(userId, { name, enabled: true })
      await recordCoreChanges(deps.db, {
        entity: 'mini-app',
        op: 'upserted',
        ref: { id: name, scope: 'global' },
      })
    },
    ...(deps.installOutcomes ? { onJobsSettled: deps.installOutcomes } : {}),
  })
  return {
    catalogs: withCatalogPreview(catalogList, store),
    store,
    autoUpdate,
    installRecommended: (userId: string) =>
      createRecommendedInstalls({
        store,
        homeDir: deps.homeDir,
        userId,
        log: (event, detail) => deps.logger?.warn(event, detail),
      }).run(),
  }
}
