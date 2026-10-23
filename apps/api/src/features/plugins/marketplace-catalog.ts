import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import {
  marketplaceSchema,
  usableEntries,
  validateMarketplace,
  type Marketplace,
  type MarketplaceRelevance,
} from './marketplace'
import { bundledMiniAppsRoot } from './discovery'
import { marketplacesRoot, type MarketplaceSource } from './marketplace-source'
import {
  locateManifest,
  MARKETPLACE_CATALOG_FILE,
  MARKETPLACE_MANIFEST_CANDIDATES,
} from './manifest-locate'
import { CLAUDE_CODE_MARKETPLACE } from './claude-code-marketplace'
import { errorMessage } from '../../lib/errors'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

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

export async function writeKnownMarketplaces(
  root: string,
  known: Record<string, KnownMarketplace>,
): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(knownFile(root), JSON.stringify(known, null, 2) + '\n')
}

/** Locate a marketplace catalog: `.localix-plugin/marketplace.json`, else Claude Code's. */
export async function findMarketplaceManifest(dir: string): Promise<string | null> {
  return locateManifest(dir, MARKETPLACE_MANIFEST_CANDIDATES)
}

/**
 * Read + deterministically validate a marketplace catalog from a materialized dir. As in Claude
 * Code, each entry is validated on its own: an invalid one is left out, not the marketplace.
 */
export async function readMarketplace(dir: string): Promise<Marketplace> {
  const manifestPath = await findMarketplaceManifest(dir)
  if (!manifestPath)
    throw new Error(`No ${MARKETPLACE_CATALOG_FILE} or ${CLAUDE_CODE_MARKETPLACE} found in ${dir}`)
  const raw = usableEntries(JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown)
  const { errors } = validateMarketplace(raw)
  if (errors.length) throw new Error(`Invalid marketplace.json: ${errors.join('; ')}`)
  return marketplaceSchema.parse(raw)
}

/** The always-present built-in marketplace backed by our bundled `plugins/` catalog. */
export const LOCALIX_MARKETPLACE = 'localix'

export function localixMarketplaceDir(deps: MarketplaceRegistryDeps): string {
  return deps.localixDir ?? bundledMiniAppsRoot()
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
  /** Why this registered marketplace cannot be read (kept listed so the user sees it). */
  unsupported?: string
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
              } catch (err) {
                return {
                  name,
                  builtin: false,
                  count: 0,
                  plugins: [],
                  unsupported: errorMessage(err),
                }
              }
            })(),
          ],
    ),
  )
  out.push(...rest)
  return out
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
