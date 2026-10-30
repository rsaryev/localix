import { defaultSource, LOCALIX_MARKETPLACE } from '@localixai/store'

import type { MiniAppStoreSource } from './store-offers'

/**
 * The hosted Localix catalog, published by the Localix marketplace's releases: the Store's default
 * mini app source (`@localixai/store`'s default sources).
 */
export const DEFAULT_MINI_APP_CATALOG_URL = defaultSource('localix-mini-apps')!.input

/** Localix Community's list of mini apps: each one a link to its author's own catalog. */
export const COMMUNITY_MINI_APP_LIST_URL = defaultSource('localix-community-mini-apps')!.input

/**
 * The catalogs every installation reads (`catalogs.ts` adds the person's own after them): the
 * hosted Localix catalog, which Localix vouches for, then Localix Community's list, which it does
 * not — an app there is its author's, signed (or not) with the author's own key, and installing it
 * asks first. The Localix catalog comes first, so a community app never takes one of its names.
 *
 * `LOCALIX_MINI_APP_CATALOG_URL` puts another in the Localix catalog's place, for trying a Localix
 * marketplace build before its release (`file://…/dist/catalog/mini-app-catalog.json` after its
 * `bun run pack`). It is vouched for as the real one is, so it is for the people who build
 * Localix, never a setting. `LOCALIX_COMMUNITY_CATALOG_URL` does the same for the community list.
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
  const community = env.LOCALIX_COMMUNITY_CATALOG_URL?.trim() || COMMUNITY_MINI_APP_LIST_URL
  return [
    { kind: 'catalog', url, vouches: true, ...(key ? { key } : {}), id: 'localix-mini-apps' },
    { kind: 'catalog', url: community, vouches: false, id: 'localix-community-mini-apps' },
  ]
}
