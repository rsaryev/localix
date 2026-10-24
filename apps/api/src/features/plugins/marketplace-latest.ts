import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { MANIFEST_FILE } from '@localixai/claude-plugin'

import { resolveEntryName } from './marketplace'
import { readMarketplace } from './marketplace-catalog'
import { resolveEntrySource } from './marketplace-entry-source'
import {
  marketplacesRoot,
  parseMarketplaceRef,
  readKnownMarketplaces,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'

/**
 * Whether `plugin update` would bring nothing new (loading.md, "Versions and updates"): a plugin's
 * version is its `plugin.json` `version`, else its marketplace entry's, and a new copy is fetched
 * only when that changes. A plugin that states no version tracks commits, so it is fetched again.
 * The `plugin.json` is read where the marketplace holds it (a relative-path entry); for a remote
 * source only the entry's version is known before fetching. A marketplace added from a local
 * folder is read in place, so its plugins are never "already at the latest".
 */
export async function isAtLatestVersion(
  source: string,
  installedVersion: string | undefined,
  deps: MarketplaceRegistryDeps,
): Promise<boolean> {
  if (!installedVersion) return false
  const ref = parseMarketplaceRef(source)
  if (!ref) return false
  const known = (await readKnownMarketplaces(deps.root ?? marketplacesRoot()))[ref.marketplace]
  // A local folder's plugins load in place, whatever their version says.
  if (!known || known.source.source === 'local' || known.source.source === 'file') return false
  try {
    const market = await readMarketplace(known.installLocation)
    const entry = market.plugins.find((p) => p.name === resolveEntryName(market, ref.plugin).name)
    if (!entry) return false
    let version = typeof entry.version === 'string' ? entry.version : undefined
    const resolved = resolveEntrySource(known.installLocation, entry, {
      pluginRoot: market.metadata?.pluginRoot,
    })
    if ('localPath' in resolved) {
      const manifest = await fs
        .readFile(join(resolved.localPath, MANIFEST_FILE), 'utf8')
        .then((text) => JSON.parse(text) as { version?: unknown })
        .catch(() => undefined)
      if (typeof manifest?.version === 'string') version = manifest.version
    }
    return version !== undefined && version === installedVersion
  } catch {
    return false
  }
}
