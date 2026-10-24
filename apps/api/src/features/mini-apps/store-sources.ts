import { defaultSource } from '@localixai/store'

import { envString } from '../../lib/env'
import { bundledMiniAppsSyncRoot } from './discovery'
import type { MiniAppStoreSource } from './store-offers'

/**
 * The hosted Localix catalog, published with every release (`release.yml`): the Store's default
 * mini app source (`@localixai/store`'s default sources).
 */
export const DEFAULT_MINI_APP_CATALOG_URL = defaultSource('localix-mini-apps')!.input

/**
 * The catalogs every installation reads (`catalogs.ts` adds the person's own after them). In a
 * development checkout, its staged `mini-apps/`, published by Localix — a change is installed
 * without a release. Otherwise the hosted Localix catalog.
 */
export async function builtInMiniAppSources(): Promise<MiniAppStoreSource[]> {
  if (envString('LOCALIX_BUNDLED_MINI_APPS_DIR')) {
    const staged = await bundledMiniAppsSyncRoot()
    if (staged)
      return [
        {
          kind: 'local',
          root: staged,
          publisher: { name: 'Localix', verified: true },
          vouches: true,
        },
      ]
  }
  return [{ kind: 'catalog', url: DEFAULT_MINI_APP_CATALOG_URL, vouches: true }]
}
