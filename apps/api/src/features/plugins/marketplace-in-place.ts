import { resolve } from 'node:path'

import { isPathBelow, isPathWithin } from '../../lib/path-containment'
import { rmrf } from '../ext/install-tree'
import {
  isLocalSource,
  marketplaceAddRefusal,
  readKnownMarketplaces,
  readMarketplace,
  writeKnownMarketplaces,
  type KnownMarketplace,
} from './kit'
import type { Marketplace, MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'
import { keptPreferences } from './marketplace-catalog'

/**
 * Marketplaces read IN PLACE: one added from a local file or folder is registered where it is,
 * never copied, as Claude Code does ("Relative-path plugins in a marketplace you added from a local
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
 * True when the registered marketplace is read in place, so its relative plugins can be too. A
 * local one whose record still points at a copy an older Localix took is a copy until updated.
 */
export const readsInPlace = (rec: KnownMarketplace | undefined, root: string): boolean =>
  !!rec && isLocalSource(rec.source) && !ownsMarketplaceDir(root, rec.installLocation)

/** What every marketplace must pass before it is registered under its catalog name. */
export async function assertRegistrable(
  market: Marketplace,
  source: MarketplaceSource,
  root: string,
): Promise<void> {
  const refused = marketplaceAddRefusal(market.name, source, await readKnownMarketplaces(root))
  if (refused) throw new Error(refused)
}

/**
 * Register a local file or folder in place (the kit's `installLocationFor`): validate its catalog
 * and record the path itself. Adding it again re-reads it; a copy an earlier version of Localix
 * took of it is Localix's own and goes. A path inside the marketplaces folder is Localix's own.
 */
export async function addMarketplaceInPlace(
  source: Extract<MarketplaceSource, { kind: 'file' | 'directory' }>,
  root: string,
  now: string,
): Promise<{ name: string; count: number }> {
  const installLocation = resolve(source.path)
  if (isPathWithin(resolve(root), installLocation))
    throw new Error(`Refusing to add ${installLocation}: it is inside the marketplaces folder`)
  const at = { source: { ...source, path: installLocation }, installLocation }
  const market = await readMarketplace(at)
  await assertRegistrable(market, at.source, root)
  const known = await readKnownMarketplaces(root)
  const previous = known[market.name]
  known[market.name] = { ...keptPreferences(previous), ...at, lastUpdated: now }
  await writeKnownMarketplaces(root, known)
  if (previous && resolve(previous.installLocation) !== installLocation)
    await removeOwnedMarketplaceDir(root, previous.installLocation).catch(() => {})
  return { name: market.name, count: market.plugins.length }
}
