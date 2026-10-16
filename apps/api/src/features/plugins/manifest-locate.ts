import { join } from 'node:path'

import { pathExists } from '../ext/fs-discovery'

/**
 * Shared "find the manifest file in this directory" core used by plugin discovery
 * (`discovery.ts` `findManifestPath`) and the marketplace registry
 * (`marketplace-registry.ts` `findMarketplaceManifest`). Both walk an ordered list
 * of candidate locations and return the first that exists — only the filenames and
 * their precedence differ, so those stay explicit per caller as constants below.
 */

/** Plugin manifest location: the native `plugin.json` at the plugin root, nothing else. */
export const PLUGIN_MANIFEST_CANDIDATES: readonly string[] = ['plugin.json']

/** The branded marketplace catalog directory and its files. */
export const MARKETPLACE_DIR = '.localix-plugin'
export const MARKETPLACE_CATALOG_FILE = `${MARKETPLACE_DIR}/marketplace.json`
export const MARKETPLACE_METADATA_FILE = `${MARKETPLACE_DIR}/marketplace.metadata.json`

/** Marketplace catalog location: only the branded `.localix-plugin/marketplace.json`. */
export const MARKETPLACE_MANIFEST_CANDIDATES: readonly string[] = [MARKETPLACE_CATALOG_FILE]

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
