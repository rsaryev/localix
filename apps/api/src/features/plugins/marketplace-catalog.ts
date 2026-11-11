import { catalogKnows, readKnownMarketplaces, readMarketplace, type KnownMarketplace } from './kit'
import type { Marketplace } from '@rsaryev/llx-plugin/marketplace'
import { marketplacesRoot } from './marketplace-source'
import { errorMessage } from '../../lib/errors'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

/** What a re-registration of the same marketplace keeps of its record: the person's choices. */
export function keptPreferences(previous: KnownMarketplace | undefined): { autoUpdate?: boolean } {
  return typeof previous?.autoUpdate === 'boolean' ? { autoUpdate: previous.autoUpdate } : {}
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
        const marketplace = await readMarketplace(rec)
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
    return [...(await readMarketplace(known)).allowCrossMarketplaceDependenciesOn]
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
        const market = await readMarketplace(rec)
        return catalogKnows(market, name) ? mName : null
      } catch {
        // unreadable catalog — skip
        return null
      }
    }),
  )
  return probed.filter((mName): mName is string => mName !== null)
}
