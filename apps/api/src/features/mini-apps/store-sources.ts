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
 *
 * `LOCALIX_MINI_APP_CATALOG_URL` puts another in its place, for trying a Localix marketplace build
 * before its release (`file://…/dist/catalog/mini-app-catalog.json` after its `bun run pack`). It
 * is vouched for as the real one is, so it is for the people who build Localix, never a setting.
 */
export async function builtInMiniAppSources(
  env: Record<string, string | undefined> = process.env,
): Promise<MiniAppStoreSource[]> {
  const url = env.LOCALIX_MINI_APP_CATALOG_URL?.trim() || DEFAULT_MINI_APP_CATALOG_URL
  return [{ kind: 'catalog', url, vouches: true }]
}
