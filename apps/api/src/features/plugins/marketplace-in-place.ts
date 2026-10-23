import { resolve } from 'node:path'

import { isPathBelow, isPathWithin } from '../../lib/path-containment'
import { rmrf } from '../ext/install-tree'
import { marketplaceNameProblem } from './claude-code-marketplace'
import type { Marketplace } from './marketplace'
import {
  LOCALIX_MARKETPLACE,
  readKnownMarketplaces,
  readMarketplace,
  writeKnownMarketplaces,
  type KnownMarketplace,
} from './marketplace-catalog'
import { differentSourceMessage, sameMarketplaceSource } from './marketplace-source-identity'
import type { MarketplaceSource } from './marketplace-source'

/**
 * Marketplaces read IN PLACE: one added from a local folder is registered where it is, never
 * copied, as Claude Code does ("Relative-path plugins in a marketplace you added from a local
 * path: the plugin loads in place", loading.md). Its `installLocation` is then the person's own
 * folder, so the registry may delete or rename a marketplace directory only when it is one of
 * Localix's own, strictly inside the marketplaces root ({@link removeOwnedMarketplaceDir}).
 */

/** True when the directory is Localix's own copy, strictly inside the marketplaces root. */
export const ownsMarketplaceDir = (root: string, dir: string): boolean =>
  isPathBelow(resolve(root), resolve(dir))

/** Delete a marketplace directory, but only one of Localix's own. */
export async function removeOwnedMarketplaceDir(root: string, dir: string): Promise<void> {
  if (ownsMarketplaceDir(root, dir)) await rmrf(dir)
}

/** Refuse a directory the registry is about to rename or delete that is not its own. */
export function assertOwnedMarketplaceDir(root: string, dir: string): void {
  if (!ownsMarketplaceDir(root, dir))
    throw new Error(`Refusing to modify ${dir}: it is outside the marketplaces folder`)
}

/**
 * A local folder outside the marketplaces root is read in place. (A folder inside it would be one
 * of Localix's own copies, which keeps being copied as before.)
 */
export const addsInPlace = (
  source: MarketplaceSource,
  root: string,
): source is { source: 'local'; path: string } =>
  source.source === 'local' && !isPathWithin(resolve(root), resolve(source.path))

/** True when the registered marketplace is read in place, so its relative plugins can be too. */
export const readsInPlace = (rec: KnownMarketplace | undefined, root: string): boolean =>
  !!rec && rec.source.source === 'local' && !ownsMarketplaceDir(root, rec.installLocation)

/** What every marketplace must pass before it is registered under its catalog name. */
export async function assertRegistrable(
  market: Marketplace,
  source: MarketplaceSource,
  root: string,
): Promise<void> {
  if (market.name === LOCALIX_MARKETPLACE)
    throw new Error(
      `"${LOCALIX_MARKETPLACE}" is the built-in marketplace and cannot be overridden.`,
    )
  const refused = marketplaceNameProblem(market.name, source)
  if (refused) throw new Error(refused)
  // A name registered from another source keeps it: re-pointing it would move where the
  // plugins installed from it update from. Replacing it takes an explicit remove first.
  const existing = (await readKnownMarketplaces(root))[market.name]
  if (existing && !sameMarketplaceSource(existing.source, source))
    throw new Error(differentSourceMessage(market.name, existing.source))
}

/**
 * Register a local folder in place: validate its catalog and record the folder itself. Adding it
 * again re-reads it; a copy an earlier version of Localix took of it is Localix's own and goes.
 */
export async function addMarketplaceInPlace(
  source: { source: 'local'; path: string },
  root: string,
): Promise<{ name: string; count: number }> {
  const installLocation = resolve(source.path)
  const market = await readMarketplace(installLocation)
  await assertRegistrable(market, source, root)
  const known = await readKnownMarketplaces(root)
  const previous = known[market.name]
  known[market.name] = { source, installLocation }
  await writeKnownMarketplaces(root, known)
  if (previous && resolve(previous.installLocation) !== installLocation)
    await removeOwnedMarketplaceDir(root, previous.installLocation).catch(() => {})
  return { name: market.name, count: market.plugins.length }
}
