import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { catalogKnows, readMarketplace, type Marketplace } from './kit'
import { marketplacesRoot, type MarketplaceSource } from './marketplace-source'
import { errorMessage } from '../../lib/errors'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

/** A registered marketplace record (mirrors CC's known_marketplaces.json entries). */
export interface KnownMarketplace {
  source: MarketplaceSource
  installLocation: string
  /** When the listing was last fetched (Claude Code's `lastUpdated`). */
  lastUpdated?: string
  /**
   * Whether the background pass refreshes it and updates its plugins (Claude Code's `autoUpdate`,
   * which the Marketplaces toggle writes). Absent: the default (`marketplace-auto-update.ts`).
   */
  autoUpdate?: boolean
  /** The commit the listing was fetched at, for a git source. */
  gitCommitSha?: string
}

/** What a re-registration of the same marketplace keeps of its record: the person's choices. */
export function keptPreferences(previous: KnownMarketplace | undefined): { autoUpdate?: boolean } {
  return typeof previous?.autoUpdate === 'boolean' ? { autoUpdate: previous.autoUpdate } : {}
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
  // Written aside and renamed in: a reader sees the old file or the new one, never half of one
  // (which reads as an empty registry).
  const aside = `${knownFile(root)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await fs.writeFile(aside, JSON.stringify(known, null, 2) + '\n')
  await fs.rename(aside, knownFile(root))
}

/** Per-entry summary carried on a marketplace listing row (UI/agent surfaces). */
export interface MarketplaceListingPlugin {
  name: string
  description?: string
}

/** One row in the merged marketplace listing. */
export interface MarketplaceListing {
  name: string
  count: number
  plugins: MarketplaceListingPlugin[]
  /** Why this registered marketplace cannot be read (kept listed so the user sees it). */
  unsupported?: string
  /** Whether the background pass auto-updates it (`marketplace-auto-update.ts`). */
  autoUpdate?: boolean
  /** An environment variable turns the whole pass off, so the toggle does nothing now. */
  autoUpdatePaused?: boolean
  /** Localix's official marketplace, registered from `LOCALIX_MARKETPLACE`'s repository. */
  official?: boolean
  /** When its listing was last fetched. */
  lastUpdated?: string
}

function toListingPlugins(market: Marketplace): MarketplaceListingPlugin[] {
  return market.plugins.map((p) => ({
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
  }))
}

/** List every registered marketplace. Localix ships none of its own. */
export async function listMarketplaces(
  deps: MarketplaceRegistryDeps,
): Promise<MarketplaceListing[]> {
  const known = await readKnownMarketplaces(deps.root ?? marketplacesRoot())
  return Promise.all(
    Object.entries(known).map(async ([name, rec]): Promise<MarketplaceListing> => {
      try {
        const marketplace = await readMarketplace(rec.installLocation, rec.source)
        return { name, count: marketplace.plugins.length, plugins: toListingPlugins(marketplace) }
      } catch (err) {
        return { name, count: 0, plugins: [], unsupported: errorMessage(err) }
      }
    }),
  )
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
    const known = (await readKnownMarketplaces(deps.root ?? marketplacesRoot()))[name]
    if (!known) return []
    return [
      ...(await readMarketplace(known.installLocation, known.source))
        .allowCrossMarketplaceDependenciesOn,
    ]
  } catch {
    return []
  }
}

/**
 * Find every registered marketplace that contains a plugin
 * named `name`. Used to resolve a bare `/plugin install <name>` (no `@marketplace`).
 */
export async function findMarketplacesWithPlugin(
  name: string,
  deps: MarketplaceRegistryDeps,
): Promise<string[]> {
  const root = deps.root ?? marketplacesRoot()
  const probed = await Promise.all(
    Object.entries(await readKnownMarketplaces(root)).map(async ([mName, rec]) => {
      try {
        // A renamed name counts too: resolution then follows it or says it was removed.
        const market = await readMarketplace(rec.installLocation, rec.source)
        return catalogKnows(market, name) ? mName : null
      } catch {
        // unreadable catalog — skip
        return null
      }
    }),
  )
  return probed.filter((mName): mName is string => mName !== null)
}
