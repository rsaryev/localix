import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { mergeEntryWithManifest, type MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import { PLUGIN_MANIFEST } from './plugin-folder'

/**
 * Localix used to write a copy's marketplace entry into the copy: a plugin with no `plugin.json`
 * got one made from its entry. The kit now merges the entry at every load (`mergeEntryWithManifest`),
 * and a `plugin.json` beside a `strict: false` entry that declares components is the conflict
 * Claude Code refuses. Localix never installed such a conflict, so in a copy it installed that
 * `plugin.json` is the one it made: dropping it leaves the plugin as it was fetched, which loads
 * with its entry as before. True when it dropped one.
 */
export async function dropSynthesizedManifest(
  dir: string,
  entry: MarketplaceEntry,
): Promise<boolean> {
  if (mergeEntryWithManifest(entry, { name: entry.name }).manifest !== undefined) return false
  return fs.rm(join(dir, PLUGIN_MANIFEST)).then(
    () => true,
    () => false,
  )
}
