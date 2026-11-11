import { entrySource } from './claude-code-installs'
import type { DiscoveredPlugin } from './discovery-types'
import { dropSynthesizedManifest, readKnownMarketplaces, readMarketplace } from './kit'
import { loadManifest } from './manifest-load'
import type { MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import { marketplacesRoot } from './marketplace-source'

/**
 * A plugin installed from a marketplace is read as Claude Code reads it: its folder, combined with
 * the entry its id names in that marketplace's catalog now (the kit's `mergeEntryWithManifest`).
 * The copy itself is the plugin as it was fetched.
 */

/** The entry `id` names in the catalog of a registered marketplace, when it is still listed. */
export async function listedEntry(
  homeDir: string,
  id: string,
): Promise<MarketplaceEntry | undefined> {
  const at = id.lastIndexOf('@')
  if (at <= 0) return undefined
  try {
    const record = (await readKnownMarketplaces(marketplacesRoot(homeDir)))[id.slice(at + 1)]
    if (!record) return undefined
    const market = await readMarketplace(record)
    return market.plugins.find((one) => one.name === id.slice(0, at))
  } catch {
    return undefined
  }
}

/**
 * Read a copy Localix installed from `id`'s marketplace. A copy an earlier Localix made a
 * `plugin.json` for, from a `strict: false` entry, loads once that file is dropped
 * (`dropSynthesizedManifest`); a folder that is not Localix's (one loading in place) is never written.
 */
export async function loadMarketplaceCopy(
  dir: string,
  id: string,
  at: { scope: 'global' | 'project'; projectId: string; homeDir: string },
): Promise<DiscoveredPlugin> {
  const entry = await listedEntry(at.homeDir, id)
  const load = () => loadManifest(dir, at.scope, at.projectId, entrySource(id, entry))
  const plugin = await load()
  if (plugin.error && entry && (await dropSynthesizedManifest(dir, entry))) return load()
  return plugin
}
