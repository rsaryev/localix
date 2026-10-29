import { defaultSource, LOCALIX_MARKETPLACE } from '@localixai/store'

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
 *
 * Its signature is checked against the key Localix pins for it (`LOCALIX_MARKETPLACE.catalogKey`),
 * never one it serves. A local build is not checked against it: `LOCALIX_MINI_APP_CATALOG_KEY`
 * names the builder's own key, and without one the build's apps read as unsigned.
 */
export async function builtInMiniAppSources(
  env: Record<string, string | undefined> = process.env,
  pinned: string | undefined = LOCALIX_MARKETPLACE.catalogKey,
): Promise<MiniAppStoreSource[]> {
  const local = env.LOCALIX_MINI_APP_CATALOG_URL?.trim()
  const url = local || DEFAULT_MINI_APP_CATALOG_URL
  const key = env.LOCALIX_MINI_APP_CATALOG_KEY?.trim() || (local ? undefined : pinned)
  return [{ kind: 'catalog', url, vouches: true, ...(key ? { key } : {}) }]
}
