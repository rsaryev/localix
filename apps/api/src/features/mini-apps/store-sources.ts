import { githubMarketplaceUrl } from '@localixai/mini-app-sdk/marketplace'
import { defaultSource, LOCALIX_COMMUNITY, LOCALIX_MARKETPLACE } from '@localixai/store'

import type { MiniAppMarketplaceSource } from './marketplaces'

/**
 * The marketplaces every installation reads (`marketplaces.ts` adds the person's own after them):
 * the Localix marketplace's release, which Localix vouches for, then Localix Community's, which it
 * does not — an app there is its author's, signed (or not) with the author's own key, and
 * installing it asks first. Localix's own comes first, so a community app never takes its names.
 * Each is checked against the keys Localix ships for it (`@localixai/store`'s default sources),
 * never keys it serves.
 *
 * `LOCALIX_MINI_APP_MARKETPLACE_URL` puts another in the Localix marketplace's place, for trying a
 * build of it before its release (`file://…/dist/marketplace/mini-app-marketplace.json` after its
 * `bun run pack`); `LOCALIX_COMMUNITY_MARKETPLACE_URL` does the same for Localix Community's. They
 * are for the people who build Localix, never a setting. A local build is not signed with the
 * release's keys: `…_KEY` names the builder's own, and without one its apps read as unsigned.
 */
export function builtInMiniAppSources(
  env: Record<string, string | undefined> = process.env,
): MiniAppMarketplaceSource[] {
  const builtIn = (
    id: string,
    shipped: { name: string; repo: string; signingKeys: readonly string[] },
    override: { url?: string; key?: string },
  ): MiniAppMarketplaceSource => {
    const local = override.url?.trim()
    const key = override.key?.trim()
    const pinned = key ? [key] : local ? undefined : shipped.signingKeys
    return {
      url: local || githubMarketplaceUrl(shipped.repo),
      name: shipped.name,
      vouches: defaultSource(id)?.editorial ?? false,
      builtIn: true,
      ...(pinned ? { pinned } : {}),
      id,
    }
  }
  return [
    builtIn('localix-mini-apps', LOCALIX_MARKETPLACE, {
      url: env.LOCALIX_MINI_APP_MARKETPLACE_URL,
      key: env.LOCALIX_MINI_APP_MARKETPLACE_KEY,
    }),
    builtIn('localix-community-mini-apps', LOCALIX_COMMUNITY, {
      url: env.LOCALIX_COMMUNITY_MARKETPLACE_URL,
      key: env.LOCALIX_COMMUNITY_MARKETPLACE_KEY,
    }),
  ]
}
