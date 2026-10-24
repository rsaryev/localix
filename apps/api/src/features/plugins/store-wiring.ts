import type { StoreProvider } from '@localixai/store'

import { cloneRepo } from './install-helpers'
import { resolveMarketplaceInstall } from './marketplace-resolve'
import { marketplacesRoot } from './marketplace-source'
import type { PluginService } from './service-types'
import { createPluginStoreProvider } from './store-provider'
import { previewMarketplace } from './store-preview'

/**
 * The plugins provider over the plugin service and its marketplaces root, as `bootstrap/` hands
 * it to the Store: a remote entry's page fetches it into the same staging folder an install
 * uses, kept for that install (`fetchEntryPlugin`'s prefetch).
 */
export function pluginStoreProviderOf(
  service: PluginService,
  opts: { homeDir: string; owner: string; cacheDir: string },
): StoreProvider {
  const root = marketplacesRoot(opts.homeDir)
  const registryDeps = { cloneRepo, root }
  return createPluginStoreProvider({
    root,
    cacheDir: opts.cacheDir,
    owner: opts.owner,
    service,
    fetchEntry: (ref) => resolveMarketplaceInstall(ref, registryDeps, { prefetch: true }),
    previewMarketplace: (input) => previewMarketplace(input, registryDeps),
  })
}
