import type { GraphFacts } from '@rsaryev/llx-plugin/marketplace'
import type { PluginCatalogEntry } from './catalog'
import { installedRecord } from './kit'
import { parseMarketplaceRef } from './marketplace-source'
import { pluginIdOf } from './plugin-data-id'

/**
 * What is installed and on, as the kit's dependency plans read it (`GraphFacts`): each plugin under
 * its `name@marketplace` (the source its row recorded, so a copy an earlier Localix made under its
 * bare name counts too; else `pluginIdOf`), at user scope or at the project's, with its on/off state.
 */
export function installedFacts(
  entries: readonly PluginCatalogEntry[],
): Pick<GraphFacts, 'installed' | 'enabled'> {
  const enabled: { user: Record<string, boolean>; project: Record<string, boolean> } = {
    user: {},
    project: {},
  }
  const installed = entries.map((entry) => {
    const { plugin, enabled: on } = entry
    const id = factIdOf(entry)
    const scope = factScopeOf(plugin)
    enabled[scope][id] = on
    return installedRecord({ id, scope, manifest: plugin.manifest })
  })
  return { installed, enabled }
}

/** The id the facts know an installed plugin by. */
export function factIdOf({ plugin, state }: Pick<PluginCatalogEntry, 'plugin' | 'state'>): string {
  const source = state?.source
  return source && parseMarketplaceRef(source) ? source : pluginIdOf(plugin)
}

export const factScopeOf = (plugin: Pick<PluginCatalogEntry['plugin'], 'scope'>) =>
  plugin.scope === 'global' ? ('user' as const) : ('project' as const)
