import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  marketplaceSchema,
  resolveEntryName,
  validateMarketplace,
  type Marketplace,
  type MarketplaceEntry,
  type MarketplaceRelevance,
} from './marketplace'
import { bundledPluginsRoot } from './discovery'
import { rmrf, stripDotGit } from '../ext/install-tree'
import {
  hashString,
  marketplacesRoot,
  resolveEntrySource,
  sourceCloneUrl,
  type MarketplaceSource,
} from './marketplace-source'
import { fetchNpmPlugin, type NpmEntrySource } from './marketplace-source-npm'
import { locateManifest, MARKETPLACE_MANIFEST_CANDIDATES } from './manifest-locate'

// Re-export the pure source-parsing + path helpers so importers keep their existing
// `./marketplace-registry` surface (this file is now a thin barrel over them).
export {
  marketplacesRoot,
  parseMarketplaceInput,
  parseMarketplaceRef,
  resolveEntrySource,
  type MarketplaceSource,
} from './marketplace-source'

/**
 * Marketplace registry — the Claude Code `/plugin marketplace add` + `install
 * name@marketplace` flow. A marketplace is a git repo or local dir holding a
 * `.claude-plugin/marketplace.json` catalog. We materialize it under
 * `~/.localix/marketplaces/<name>/` and track the set in `known.json` (keyed by name,
 * mirroring CC's `known_marketplaces.json`: `{ source, installLocation }`).
 *
 * One unified system: resolution always ends in a local plugin directory handed to
 * `pluginService.install`, so a marketplace install reuses the same copy/enable/
 * discovery path as every other install. Our own bundled catalog is a built-in
 * marketplace (`localix`) that takes priority on a name clash.
 */

/** A registered marketplace record (mirrors CC's known_marketplaces.json entries). */
export interface KnownMarketplace {
  source: MarketplaceSource
  installLocation: string
}

const knownFile = (root: string): string => join(root, 'known.json')

export async function readKnownMarketplaces(
  root: string,
): Promise<Record<string, KnownMarketplace>> {
  try {
    return JSON.parse(await fs.readFile(knownFile(root), 'utf8')) as Record<
      string,
      KnownMarketplace
    >
  } catch {
    return {}
  }
}

async function writeKnownMarketplaces(
  root: string,
  known: Record<string, KnownMarketplace>,
): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(knownFile(root), JSON.stringify(known, null, 2) + '\n')
}

/** Locate a marketplace manifest: `.claude-plugin/marketplace.json` or root `marketplace.json`. */
export async function findMarketplaceManifest(dir: string): Promise<string | null> {
  return locateManifest(dir, MARKETPLACE_MANIFEST_CANDIDATES)
}

/** Read + deterministically validate a marketplace catalog from a materialized dir. */
export async function readMarketplace(dir: string): Promise<Marketplace> {
  const manifestPath = await findMarketplaceManifest(dir)
  if (!manifestPath) throw new Error(`No .claude-plugin/marketplace.json found in ${dir}`)
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown
  const { errors } = validateMarketplace(raw)
  if (errors.length) throw new Error(`Invalid marketplace.json: ${errors.join('; ')}`)
  return marketplaceSchema.parse(raw)
}

/** Deps the registry needs from the host (kept injectable so the logic stays testable). */
export interface MarketplaceRegistryDeps {
  /** Shallow-clone `url` (optional `ref`) into `dest`; throws on failure. */
  cloneRepo: (url: string, dest: string, ref?: string) => Promise<void>
  /** Download an npm plugin source into `dest`. Defaults to {@link fetchNpmPlugin} (tests stub). */
  fetchNpm?: (src: NpmEntrySource, dest: string) => Promise<void>
  /** Marketplaces root override (tests). Defaults to `~/.localix/marketplaces`. */
  root?: string
  /** Bundled plugins root, the built-in `localix` marketplace dir. Defaults to {@link bundledPluginsRoot}. */
  localixDir?: string
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

/** The always-present built-in marketplace backed by our bundled `plugins/` catalog. */
export const LOCALIX_MARKETPLACE = 'localix'

function localixMarketplaceDir(deps: MarketplaceRegistryDeps): string {
  return deps.localixDir ?? bundledPluginsRoot()
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

  const staging = join(root, `.staging-${Math.abs(hashString(JSON.stringify(source)))}`)
  await rmrf(staging)
  if (source.source === 'local') {
    await fs.cp(source.path, staging, { recursive: true })
  } else if (source.source === 'npm') {
    // Same staging helper as npm ENTRY sources — the tarball just needs a
    // `.claude-plugin/marketplace.json` at its root. Failures are the npm path's
    // typed ApiErrors (plugin_npm_fetch_failed / plugin_npm_no_version / …).
    await (deps.fetchNpm ?? fetchNpmPlugin)(source, staging)
  } else {
    const url = sourceCloneUrl(source)
    if (!url) throw new Error('Unsupported marketplace source')
    await deps.cloneRepo(url, staging, source.ref)
  }
  await stripDotGit(staging)

  let market: Marketplace
  try {
    market = await readMarketplace(staging)
  } catch (err) {
    await rmrf(staging)
    throw err
  }
  if (market.name === LOCALIX_MARKETPLACE) {
    await rmrf(staging)
    throw new Error(
      `"${LOCALIX_MARKETPLACE}" is the built-in marketplace and cannot be overridden.`,
    )
  }

  const installLocation = join(root, market.name)
  const backupLocation = join(root, `.backup-${market.name}-${randomUUID()}`)
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
    known[market.name] = { source, installLocation }
    await writeKnownMarketplaces(root, known)
    if (hasBackup) await rmrf(backupLocation).catch(() => {})
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
  if (name === LOCALIX_MARKETPLACE)
    throw new Error(`The built-in "${LOCALIX_MARKETPLACE}" marketplace cannot be updated.`)
  const root = deps.root ?? marketplacesRoot()
  const rec = (await readKnownMarketplaces(root))[name]
  if (!rec) throw new Error(`Unknown marketplace "${name}".`)
  const res = await addMarketplace(rec.source, deps)
  if (res.name !== name) await removeMarketplace(name, deps)
  return res
}

/** Remove a registered marketplace (the built-in `localix` cannot be removed). */
async function removeMarketplaceUnlocked(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<void> {
  if (name === LOCALIX_MARKETPLACE)
    throw new Error(`The built-in "${LOCALIX_MARKETPLACE}" marketplace cannot be removed.`)
  const root = deps.root ?? marketplacesRoot()
  const known = await readKnownMarketplaces(root)
  const entry = known[name]
  if (!entry) throw new Error(`Unknown marketplace "${name}".`)
  delete known[name]
  await writeKnownMarketplaces(root, known)
  await rmrf(entry.installLocation)
}

export async function removeMarketplace(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<void> {
  const root = deps.root ?? marketplacesRoot()
  return withMarketplaceMutationLock(root, () => removeMarketplaceUnlocked(name, deps))
}

/** Per-entry summary carried on a marketplace listing row (UI/agent surfaces). */
export interface MarketplaceListingPlugin {
  name: string
  description?: string
  /** CC `relevance` hints, parsed + typed. Suggestion ranking is deferred (unused yet). */
  relevance?: MarketplaceRelevance
}

/** One row in the merged marketplace listing. */
export interface MarketplaceListing {
  name: string
  builtin: boolean
  count: number
  plugins: MarketplaceListingPlugin[]
}

function toListingPlugins(market: Marketplace): MarketplaceListingPlugin[] {
  return market.plugins.map((p) => ({
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.relevance ? { relevance: p.relevance } : {}),
  }))
}

/**
 * List every marketplace: the built-in `localix` catalog FIRST (priority), then each
 * registered one. Names are merged logically (not file-wise) — `localix` always leads.
 */
export async function listMarketplaces(
  deps: MarketplaceRegistryDeps,
): Promise<MarketplaceListing[]> {
  const out: MarketplaceListing[] = []
  try {
    const localix = await readMarketplace(localixMarketplaceDir(deps))
    out.push({
      name: LOCALIX_MARKETPLACE,
      builtin: true,
      count: localix.plugins.length,
      plugins: toListingPlugins(localix),
    })
  } catch {
    // bundled catalog missing (shouldn't happen) — skip
  }
  const known = await readKnownMarketplaces(deps.root ?? marketplacesRoot())
  const rest = await Promise.all(
    Object.entries(known).flatMap(([name, rec]) =>
      name === LOCALIX_MARKETPLACE
        ? []
        : [
            (async (): Promise<MarketplaceListing> => {
              try {
                const marketplace = await readMarketplace(rec.installLocation)
                return {
                  name,
                  builtin: false,
                  count: marketplace.plugins.length,
                  plugins: toListingPlugins(marketplace),
                }
              } catch {
                return { name, builtin: false, count: 0, plugins: [] }
              }
            })(),
          ],
    ),
  )
  out.push(...rest)
  return out
}

/** Result of resolving a marketplace plugin reference to a local install path. */
export interface ResolvedMarketplaceInstall {
  /** Absolute local directory containing the plugin (ready to pass to `install`). */
  dir: string
  /** The resolved marketplace entry (carries `defaultEnabled` and other metadata). */
  entry: MarketplaceEntry
  /** The marketplace the entry came from (dependency resolution's parent catalog). */
  marketplace: string
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
  const marketplaceDir =
    ref.marketplace === LOCALIX_MARKETPLACE
      ? localixMarketplaceDir(deps)
      : (await readKnownMarketplaces(root))[ref.marketplace]?.installLocation
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
  if ('localPath' in resolved) return { dir: resolved.localPath, ...base }

  // Remote sources stage into a stable temp dir under the marketplaces root; git and
  // npm land the same shape (a plain plugin dir handed to `installFromLocal`).
  const staging = join(root, `.fetch-${Math.abs(hashString(ref.plugin + ref.marketplace))}`)
  await rmrf(staging)
  if ('npm' in resolved) {
    await (deps.fetchNpm ?? fetchNpmPlugin)(resolved.npm, staging)
    return { dir: staging, ...base }
  }
  await deps.cloneRepo(resolved.git.url, staging, resolved.git.ref)
  await stripDotGit(staging)
  const dir = resolved.git.subdir ? join(staging, resolved.git.subdir) : staging
  return { dir, ...base }
}

/**
 * Read a marketplace catalog's `allowCrossMarketplaceDependenciesOn` list. Returns []
 * for an unknown/unreadable marketplace or when the field is absent (nothing allowed).
 */
export async function marketplaceDependencyAllowList(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<string[]> {
  try {
    const dir =
      name === LOCALIX_MARKETPLACE
        ? localixMarketplaceDir(deps)
        : (await readKnownMarketplaces(deps.root ?? marketplacesRoot()))[name]?.installLocation
    if (!dir) return []
    return (await readMarketplace(dir)).allowCrossMarketplaceDependenciesOn ?? []
  } catch {
    return []
  }
}

/**
 * Find every registered marketplace (built-in `localix` + known) that contains a plugin
 * named `name`. Used to resolve a bare `/plugin install <name>` (no `@marketplace`).
 */
export async function findMarketplacesWithPlugin(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<string[]> {
  const root = deps.root ?? marketplacesRoot()
  const dirs: Array<[string, string]> = [[LOCALIX_MARKETPLACE, localixMarketplaceDir(deps)]]
  for (const [mName, rec] of Object.entries(await readKnownMarketplaces(root))) {
    if (mName !== LOCALIX_MARKETPLACE) dirs.push([mName, rec.installLocation])
  }
  const probed = await Promise.all(
    dirs.map(async ([mName, dir]) => {
      try {
        const market = await readMarketplace(dir)
        // A rename KEY also counts as "has the plugin": resolution then follows the
        // redirect (old→new) or surfaces the informative "removed" error (null).
        const has =
          market.plugins.some((p) => p.name === name) ||
          (market.renames ? name in market.renames : false)
        return has ? mName : null
      } catch {
        // unreadable catalog — skip
        return null
      }
    }),
  )
  return probed.filter((mName): mName is string => mName !== null)
}

/**
 * Resolve a bare plugin name (no `@marketplace`) to a local install dir (and the
 * resolved marketplace entry) by searching registered marketplaces. Exactly one match
 * → resolve it; the built-in `localix` wins if it also has the name. Zero → throw
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
  // localix takes priority; otherwise a single unambiguous match.
  const chosen = hits.includes(LOCALIX_MARKETPLACE)
    ? LOCALIX_MARKETPLACE
    : hits.length === 1
      ? hits[0]
      : null
  if (!chosen) {
    throw new Error(
      `Plugin "${name}" is in multiple marketplaces (${hits.join(', ')}). Disambiguate: /plugin install ${name}@${hits[0]}`,
    )
  }
  return resolveMarketplaceInstall({ plugin: name, marketplace: chosen }, deps)
}
