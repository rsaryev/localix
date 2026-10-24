import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { Marketplace } from './marketplace'
import { rmrf } from '../ext/install-tree'
import { hashString, marketplacesRoot, type MarketplaceSource } from './marketplace-source'
import type { NpmEntrySource } from './marketplace-source-npm'
import { materializeMarketplace } from './marketplace-materialize'
import {
  addMarketplaceInPlace,
  addsInPlace,
  assertOwnedMarketplaceDir,
  assertRegistrable,
  removeOwnedMarketplaceDir,
} from './marketplace-in-place'

import {
  keptPreferences,
  readKnownMarketplaces,
  writeKnownMarketplaces,
  readMarketplace,
} from './marketplace-catalog'
import { assertMarketplaceAllowed } from './claude-code-policy'

export {
  readKnownMarketplaces,
  listMarketplaces,
  marketplaceDependencyAllowList,
  findMarketplacesWithPlugin,
  type KnownMarketplace,
  type MarketplaceListing,
} from './marketplace-catalog'

// Re-export the pure source-parsing + path helpers so importers keep their existing
// `./marketplace-registry` surface.
export {
  marketplacesRoot,
  parseMarketplaceInput,
  parseMarketplaceRef,
  resolveEntrySource,
  type MarketplaceSource,
} from './marketplace-source'

/**
 * Marketplace registry — the Claude Code `/plugin marketplace add` + `install
 * name@marketplace` flow. A marketplace is a git repo, local dir, catalog file or hosted
 * catalog holding a `.localix-plugin/marketplace.json` or Claude Code
 * `.claude-plugin/marketplace.json` catalog. We materialize it under
 * `~/.localix/marketplaces/<name>/` (a local folder is read in place, see
 * `marketplace-in-place.ts`) and track the set in `known.json` (keyed by name,
 * mirroring CC's `known_marketplaces.json`: `{ source, installLocation }`).
 *
 * One unified system: resolution always ends in a local plugin directory handed to
 * `pluginService.install`, so a marketplace install reuses the same copy/enable/
 * discovery path as every other install. Our own bundled catalog is a built-in
 * marketplace (`localix`) that takes priority on a name clash.
 */

/** Deps the registry needs from the host (kept injectable so the logic stays testable). */
export interface MarketplaceRegistryDeps {
  /**
   * Fetch `url` at `ref` (a branch, tag or commit; the default branch when absent) into `dest`,
   * checking out only the `sparse` directory when given; throws on failure.
   */
  cloneRepo: (url: string, dest: string, ref?: string, sparse?: string | string[]) => Promise<void>
  /** Download an npm plugin source into `dest`. Defaults to `fetchNpmPlugin` (tests stub). */
  fetchNpm?: (src: NpmEntrySource, dest: string) => Promise<void>
  /** Download an archive plugin source into `dest`. Defaults to `fetchArchivePlugin`. */
  fetchArchive?: (
    src: { url: string; sha256?: string; headers?: Record<string, string> },
    dest: string,
  ) => Promise<void>
  /** Marketplaces root override (tests). Defaults to `~/.localix/marketplaces`. */
  root?: string
  /** Claude Code's managed settings directory (tests); the platform's system one by default. */
  managedSettingsDir?: string
  /** A repository's tag names (`git ls-remote --tags`); tests stub it. */
  listTags?: (url: string) => Promise<string[]>
  /** Timestamp for `lastUpdated` (tests pass a fixed value; `new Date()` is avoided in code paths that resume). */
  now?: () => string
}

const marketplaceMutationTails = new Map<string, Promise<void>>()

async function withMarketplaceMutationLock<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = marketplaceMutationTails.get(root) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((resolve) => {
    release = resolve
  })
  marketplaceMutationTails.set(root, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (marketplaceMutationTails.get(root) === tail) marketplaceMutationTails.delete(root)
  }
}

/**
 * Register a marketplace by source: clone/copy it under the marketplaces root, validate
 * its catalog, and persist it in known.json. Returns the catalog name + entry count.
 */
async function addMarketplaceUnlocked(
  source: MarketplaceSource,
  deps: MarketplaceRegistryDeps,
): Promise<{ name: string; count: number }> {
  const root = deps.root ?? marketplacesRoot()
  // The organization's policy is checked before anything is fetched or written.
  await assertMarketplaceAllowed(source, deps.managedSettingsDir)
  await fs.mkdir(root, { recursive: true })
  if (addsInPlace(source, root)) return addMarketplaceInPlace(source, root)

  const staging = join(root, `.staging-${Math.abs(hashString(JSON.stringify(source)))}`)
  let market: Marketplace
  let fetched: { commitSha?: string }
  try {
    fetched = await materializeMarketplace(source, staging, deps)
    market = await readMarketplace(staging)
    await assertRegistrable(market, source, root)
  } catch (err) {
    await rmrf(staging)
    throw err
  }

  const installLocation = join(root, market.name)
  const backupLocation = join(root, `.backup-${market.name}-${randomUUID()}`)
  // Only Localix's own directories are renamed or deleted, never a folder registered in place.
  assertOwnedMarketplaceDir(root, installLocation)
  assertOwnedMarketplaceDir(root, backupLocation)
  let hasBackup = false
  let activated = false
  try {
    try {
      await fs.rename(installLocation, backupLocation)
      hasBackup = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.rename(staging, installLocation)
    activated = true

    const known = await readKnownMarketplaces(root)
    const previous = known[market.name]
    known[market.name] = {
      ...keptPreferences(previous),
      source,
      installLocation,
      lastUpdated: (deps.now ?? (() => new Date().toISOString()))(),
      ...(fetched.commitSha ? { gitCommitSha: fetched.commitSha } : {}),
    }
    await writeKnownMarketplaces(root, known)
    if (hasBackup) await rmrf(backupLocation).catch(() => {})
    // A record that pointed at a folder read in place leaves that folder alone.
    if (previous && previous.installLocation !== installLocation)
      await removeOwnedMarketplaceDir(root, previous.installLocation).catch(() => {})
  } catch (error) {
    try {
      if (activated) await rmrf(installLocation)
      if (hasBackup) await fs.rename(backupLocation, installLocation)
    } catch (rollbackError) {
      throw Object.assign(
        new Error(
          `Failed to activate marketplace "${market.name}" and restore its previous version`,
        ),
        { cause: error, rollbackError },
      )
    } finally {
      await rmrf(staging).catch(() => {})
    }
    throw error
  }
  return { name: market.name, count: market.plugins.length }
}

export async function addMarketplace(
  source: MarketplaceSource,
  deps: MarketplaceRegistryDeps,
): Promise<{ name: string; count: number }> {
  const root = deps.root ?? marketplacesRoot()
  return withMarketplaceMutationLock(root, () => addMarketplaceUnlocked(source, deps))
}

/**
 * Update a registered marketplace by re-materializing it from its recorded source:
 * a git/github source re-clones; an npm source re-fetches the latest version
 * satisfying its recorded range (or the latest dist-tag when unpinned). Rare edge:
 * if the refreshed catalog renamed itself, the stale record + dir are dropped.
 */
export async function updateMarketplace(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<{ name: string; count: number }> {
  const root = deps.root ?? marketplacesRoot()
  const rec = (await readKnownMarketplaces(root))[name]
  if (!rec) throw new Error(`Unknown marketplace "${name}".`)
  const res = await addMarketplace(rec.source, deps)
  if (res.name !== name) await removeMarketplace(name, deps)
  return res
}

/** Remove a registered marketplace. */
async function removeMarketplaceUnlocked(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<void> {
  const root = deps.root ?? marketplacesRoot()
  const known = await readKnownMarketplaces(root)
  const entry = known[name]
  if (!entry) throw new Error(`Unknown marketplace "${name}".`)
  delete known[name]
  await writeKnownMarketplaces(root, known)
  // A marketplace read in place is the person's folder: only Localix's own copy is deleted.
  await removeOwnedMarketplaceDir(root, entry.installLocation)
}

export async function removeMarketplace(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<void> {
  const root = deps.root ?? marketplacesRoot()
  return withMarketplaceMutationLock(root, () => removeMarketplaceUnlocked(name, deps))
}

// Resolving `plugin@marketplace` (or a bare name) to a local install (`marketplace-resolve.ts`).
export {
  resolveBareInstall,
  resolveMarketplaceInstall,
  type ResolvedMarketplaceInstall,
} from './marketplace-resolve'
