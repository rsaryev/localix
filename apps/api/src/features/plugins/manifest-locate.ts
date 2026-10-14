import { join } from 'node:path'

import { pathExists } from '../ext/fs-discovery'

/**
 * Shared "find the manifest file in this directory" core used by plugin discovery
 * (`discovery.ts` `findManifestPath`) and the marketplace registry
 * (`marketplace-registry.ts` `findMarketplaceManifest`). Both walk an ordered list
 * of candidate locations and return the first that exists — only the filenames and
 * their precedence differ, so those stay explicit per caller as constants below.
 */

/**
 * Plugin manifest candidates: our native layout (`plugin.json` at the plugin root)
 * and the Claude Code convention (`.claude-plugin/plugin.json`). The ROOT manifest
 * wins when both exist.
 */
export const PLUGIN_MANIFEST_CANDIDATES: readonly string[] = [
  'plugin.json',
  '.claude-plugin/plugin.json',
]

/**
 * Marketplace catalog candidates: the CC-spec `.claude-plugin/marketplace.json`
 * wins over a root `marketplace.json`. (Note the precedence is the REVERSE of the
 * plugin-manifest convention — the dotted dir leads here.)
 */
export const MARKETPLACE_MANIFEST_CANDIDATES: readonly string[] = [
  '.claude-plugin/marketplace.json',
  'marketplace.json',
]

/**
 * Return the absolute path of the first candidate (relative to `dir`) that exists,
 * or null when none do. Candidate order IS the precedence order.
 */
export async function locateManifest(
  dir: string,
  candidates: readonly string[],
): Promise<string | null> {
  for (const rel of candidates) {
    const abs = join(dir, rel)
    if (await pathExists(abs)) return abs
  }
  return null
}
