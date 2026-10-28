import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { resolveEntryName, type MarketplaceEntry } from './marketplace'
import {
  hashString,
  marketplacesRoot,
  resolveEntrySource,
  sourceMatchesRef,
} from './marketplace-source'
import { fetchEntryPlugin } from './marketplace-materialize'
import { readsInPlace } from './marketplace-in-place'
import {
  findMarketplacesWithPlugin,
  readKnownMarketplaces,
  readMarketplace,
} from './marketplace-catalog'
import { withSourceHeaders } from './marketplace-headers'
import { withEntryHelperHeaders } from './entry-headers-helper'
import { assertMarketplaceAllowed, readManagedPolicy } from './claude-code-policy'
import { tagInRange } from './dependency-tags'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

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
  /** The commit the plugin's files come from, when that is a git checkout. */
  commitSha?: string
  /**
   * Set when the requested name was an OLD name the catalog's `renames` map redirected
   * (CC 2.1.193+) — callers can surface "installed as <entry.name>" to the user.
   */
  renamedFrom?: string
  /** The version of the `<plugin>--v<version>` tag a version range resolved to. */
  tagVersion?: string
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
  opts?: {
    versionRange?: string
    /** The person accepted this entry's `headersHelper` (`entry-headers-helper.ts`). */
    acceptCommand?: string
    /** Fetched for a Store page: kept for the install that may follow (`fetchEntryPlugin`). */
    prefetch?: boolean
  },
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

  const registered = (byName ?? bySource?.[1])?.source
  if (registered) await assertMarketplaceAllowed(registered, deps.managedSettingsDir)
  const market = await readMarketplace(marketplaceDir)
  // Apply the catalog's `renames` map first: an old name redirects to its successor;
  // a null mapping throws "removed from marketplace" (informative, not "not found").
  const requested = resolveEntryName(market, ref.plugin)
  const renamedFrom = requested.renamedFrom
  const entry = market.plugins.find((p) => p.name === requested.name)
  if (!entry)
    throw new Error(`Plugin "${requested.name}" not found in marketplace "${ref.marketplace}"`)
  const id = `${entry.name}@${ref.marketplace}`
  if (!((await readManagedPolicy(deps.managedSettingsDir)).enabledPlugins[id] ?? true))
    throw new Error(`Plugin "${id}" is blocked by managed settings (enabledPlugins)`)

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
    if (hosted?.source === 'url')
      throw new Error(
        `Marketplace "${ref.marketplace}" was added from a URL, so its relative source "${typeof entry.source === 'string' ? entry.source : JSON.stringify(entry.source)}" cannot be fetched; the entry needs a github, url or git-subdir source`,
      )
    if (!(await fs.stat(resolved.localPath).catch(() => null))?.isDirectory())
      throw new Error(`Source path does not exist: ${resolved.localPath}`)
    const inPlace = readsInPlace(byName ?? bySource?.[1], root) ? { inPlace: true } : {}
    // A relative entry of a git-hosted marketplace is at the marketplace's commit.
    const commit = (byName ?? bySource?.[1])?.gitCommitSha
    const commitSha = commit ? { commitSha: commit } : {}
    return { dir: resolved.localPath, linkRoot: marketplaceDir, ...base, ...inPlace, ...commitSha }
  }

  // A version range picks the highest `<plugin>--v<version>` tag of the plugin's own repository.
  let tagVersion: string | undefined
  if (opts?.versionRange && 'git' in resolved) {
    const tag = await tagInRange(entry.name, resolved.git.url, opts.versionRange, deps)
    if (!tag)
      throw new Error(
        `Dependency "${entry.name}@${ref.marketplace}" has no git tag satisfying "${opts.versionRange}"`,
      )
    resolved.git = { ...resolved.git, ref: tag.tag }
    tagVersion = tag.version
  }
  // An archive on a url marketplace's origin gets that source's headers; the entry's win a name.
  const hostedBy = known[ref.marketplace]?.source
  if ('archive' in resolved && hostedBy?.source === 'url')
    resolved.archive = await withSourceHeaders(resolved.archive, hostedBy)
  // An entry's headersHelper runs only once the person accepted it; its output wins a name.
  if ('archive' in resolved)
    resolved.archive = await withEntryHelperHeaders(
      resolved.archive,
      entry.name,
      opts?.acceptCommand,
    )
  // Remote sources stage into a stable temp dir under the marketplaces root; git, npm and
  // archives land the same shape (a plain plugin dir handed to `installFromLocal`).
  const staging = join(root, `.fetch-${Math.abs(hashString(`${ref.plugin}\0${ref.marketplace}`))}`)
  const fetched = await fetchEntryPlugin(resolved, staging, deps, {
    prefetch: opts?.prefetch ?? false,
  })
  return { ...fetched, linkRoot: staging, ...base, ...(tagVersion ? { tagVersion } : {}) }
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
