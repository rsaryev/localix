import { defaultSource } from '@localixai/store'

import type { MiniAppStoreSource } from './store-offers'

/**
 * The hosted Localix catalog, published by the Localix marketplace's releases: the Store's default
 * mini app source (`@localixai/store`'s default sources).
 */
export const DEFAULT_MINI_APP_CATALOG_URL = defaultSource('localix-mini-apps')!.input

/**
 * The catalogs every installation reads (`catalogs.ts` adds the person's own after them): the
 * hosted Localix catalog, which Localix vouches for.
 */
export async function builtInMiniAppSources(): Promise<MiniAppStoreSource[]> {
  return [{ kind: 'catalog', url: DEFAULT_MINI_APP_CATALOG_URL, vouches: true }]
}
