import { resolveEntryName } from './marketplace'
import { readMarketplace } from './marketplace-catalog'
import { resolveEntrySource } from './marketplace-entry-source'
import {
  marketplacesRoot,
  readKnownMarketplaces,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { lsRemoteTags } from './dependency-tags'

/**
 * The versions a marketplace can install `name` at: the `<name>--v<version>` release tags of the
 * plugin's own git repository (dependencies.md, "Release a plugin that others depend on"). Empty
 * for a plugin whose source is not a git repository, or whose catalog cannot be read: its ranges
 * are then checked against what it installs.
 */
export async function dependencyTagVersions(
  name: string,
  marketplace: string,
  deps: MarketplaceRegistryDeps,
): Promise<string[]> {
  try {
    const known = (await readKnownMarketplaces(deps.root ?? marketplacesRoot()))[marketplace]
    if (!known) return []
    const market = await readMarketplace(known.installLocation)
    const entry = market.plugins.find((p) => p.name === resolveEntryName(market, name).name)
    if (!entry) return []
    const resolved = resolveEntrySource(known.installLocation, entry, {
      pluginRoot: market.metadata?.pluginRoot,
    })
    if (!('git' in resolved)) return []
    const prefix = `${entry.name}--v`
    return (await (deps.listTags ?? lsRemoteTags)(resolved.git.url))
      .filter((tag) => tag.startsWith(prefix))
      .map((tag) => tag.slice(prefix.length))
  } catch {
    return []
  }
}
