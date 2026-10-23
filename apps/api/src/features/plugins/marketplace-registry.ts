import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { resolveEntryName, type Marketplace, type MarketplaceEntry } from './marketplace'
import { rmrf } from '../ext/install-tree'
import {
  hashString,
  marketplacesRoot,
  resolveEntrySource,
  sourceMatchesRef,
  type MarketplaceSource,
} from './marketplace-source'
import type { NpmEntrySource } from './marketplace-source-npm'
import { fetchEntryPlugin, materializeMarketplace } from './marketplace-materialize'
import {
  addMarketplaceInPlace,
  addsInPlace,
  assertOwnedMarketplaceDir,
  assertRegistrable,
  readsInPlace,
  removeOwnedMarketplaceDir,
} from './marketplace-in-place'

import {
  readKnownMarketplaces,
  writeKnownMarketplaces,
  readMarketplace,
  findMarketplacesWithPlugin,
} from './marketplace-catalog'

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
  cloneRepo: (url: string, dest: string, ref?: string, sparse?: string) => Promise<void>
  /** Download an npm plugin source into `dest`. Defaults to `fetchNpmPlugin` (tests stub). */
  fetchNpm?: (src: NpmEntrySource, dest: string) => Promise<void>
  /** Download an archive plugin source into `dest`. Defaults to `fetchArchivePlugin`. */
  fetchArchive?: (src: { url: string; sha256?: string }, dest: string) => Promise<void>
  /** Marketplaces root override (tests). Defaults to `~/.localix/marketplaces`. */
  root?: string
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
  await fs.mkdir(root, { recursive: true })
  if (addsInPlace(source, root)) return addMarketplaceInPlace(source, root)

  const staging = join(root, `.staging-${Math.abs(hashString(JSON.stringify(source)))}`)
  let market: Marketplace
  try {
    await materializeMarketplace(source, staging, deps)
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
    known[market.name] = { source, installLocation }
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

/** Result of resolving a marketplace plugin reference to a local install path. */
export interface ResolvedMarketplaceInstall {
  /** Absolute local directory containing the plugin (ready to pass to `install`). */
  dir: string
  /**
   * The marketplace (or fetched checkout) holding `dir`. Copying the plugin dereferences its
   * symlinks into this root and drops links that leave it, as Claude Code does.
   */
  linkRoot: string
  /** The resolved marketplace entry (carries `defaultEnabled` and other metadata). */
  entry: MarketplaceEntry
  /** The marketplace the entry came from (dependency resolution's parent catalog). */
  marketplace: string
  /**
   * The entry is a relative path in a marketplace read in place (added from a local folder), so
   * `dir` is the person's folder and the plugin may load from it (`install-in-place.ts`).
   */
  inPlace?: boolean
  /** The catalog's `allowCrossMarketplaceDependenciesOn` list (absent → none allowed). */
  allowCrossMarketplaceDependenciesOn?: string[]
  /**
   * Set when the requested name was an OLD name the catalog's `renames` map redirected
   * (CC 2.1.193+) — callers can surface "installed as <entry.name>" to the user.
   */
  renamedFrom?: string
}

/**
 * Resolve `plugin@marketplace` to an absolute local plugin directory ready to install,
 * alongside the resolved marketplace entry (which carries `defaultEnabled` and other
 * metadata the installer may consume).
 *
 * The built-in `localix` marketplace resolves against the bundled catalog and takes
 * priority if a user marketplace reuses the name. Relative entry sources resolve inside
 * the materialized marketplace; remote sources are cloned into a temp dir.
 */
export async function resolveMarketplaceInstall(
  ref: { plugin: string; marketplace: string },
  deps: MarketplaceRegistryDeps,
): Promise<ResolvedMarketplaceInstall> {
  const root = deps.root ?? marketplacesRoot()
  const known = await readKnownMarketplaces(root)
  // A marketplace is addressed by its catalog name, or by the source it was added from.
  const byName = known[ref.marketplace]
  const bySource = byName
    ? undefined
    : Object.entries(known).find(([, rec]) => sourceMatchesRef(rec.source, ref.marketplace))
  if (bySource) ref = { ...ref, marketplace: bySource[0] }
  const marketplaceDir = (byName ?? bySource?.[1])?.installLocation
  if (!marketplaceDir)
    throw new Error(
      `Unknown marketplace "${ref.marketplace}". Add it first: /plugin marketplace add <owner/repo>`,
    )

  const market = await readMarketplace(marketplaceDir)
  // Apply the catalog's `renames` map first: an old name redirects to its successor;
  // a null mapping throws "removed from marketplace" (informative, not "not found").
  const requested = resolveEntryName(market, ref.plugin)
  const renamedFrom = requested.renamedFrom
  const entry = market.plugins.find((p) => p.name === requested.name)
  if (!entry)
    throw new Error(`Plugin "${requested.name}" not found in marketplace "${ref.marketplace}"`)

  // Honor the catalog's `metadata.pluginRoot` so relative entry sources resolve
  // against the declared plugins subdir (e.g. `./plugins`), not the marketplace root.
  const resolved = resolveEntrySource(marketplaceDir, entry, {
    pluginRoot: market.metadata?.pluginRoot,
  })
  const base = {
    entry,
    marketplace: ref.marketplace,
    ...(market.allowCrossMarketplaceDependenciesOn
      ? { allowCrossMarketplaceDependenciesOn: market.allowCrossMarketplaceDependenciesOn }
      : {}),
    ...(renamedFrom ? { renamedFrom } : {}),
  }
  if ('localPath' in resolved) {
    // A hosted catalog brought only its marketplace.json: there is no tree to resolve against.
    const hosted = known[ref.marketplace]?.source
    if (hosted && hosted.source === 'url')
      throw new Error(
        `Marketplace "${ref.marketplace}" was added from a URL, so its relative source "${String(entry.source)}" cannot be fetched; the entry needs a github, url or git-subdir source`,
      )
    if (!(await fs.stat(resolved.localPath).catch(() => null))?.isDirectory())
      throw new Error(`Source path does not exist: ${resolved.localPath}`)
    const inPlace = readsInPlace(byName ?? bySource?.[1], root) ? { inPlace: true } : {}
    return { dir: resolved.localPath, linkRoot: marketplaceDir, ...base, ...inPlace }
  }

  // Remote sources stage into a stable temp dir under the marketplaces root; git, npm and
  // archives land the same shape (a plain plugin dir handed to `installFromLocal`).
  const staging = join(root, `.fetch-${Math.abs(hashString(`${ref.plugin}\0${ref.marketplace}`))}`)
  return { dir: await fetchEntryPlugin(resolved, staging, deps), linkRoot: staging, ...base }
}

/**
 * Resolve a bare plugin name (no `@marketplace`) to a local install dir (and the
 * resolved marketplace entry) by searching registered marketplaces. Exactly one match
 * → resolve it. Zero → throw
 * "not found"; many → throw asking for `name@market`.
 */
export async function resolveBareInstall(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<ResolvedMarketplaceInstall> {
  const hits = await findMarketplacesWithPlugin(name, deps)
  if (hits.length === 0) {
    throw new Error(
      `Plugin "${name}" isn't a local path, a git URL, or in any registered marketplace. Add a marketplace first (/plugin marketplace add <owner/repo>) or pass <name>@<marketplace>.`,
    )
  }
  const chosen = hits.length === 1 ? hits[0] : null
  if (!chosen) {
    throw new Error(
      `Plugin "${name}" is in multiple marketplaces (${hits.join(', ')}). Disambiguate: /plugin install ${name}@${hits[0]}`,
    )
  }
  return resolveMarketplaceInstall({ plugin: name, marketplace: chosen }, deps)
}
