import { join } from 'node:path'

import { pathExists } from '../ext/fs-discovery'
import { PLUGIN_MANIFEST } from './kit'

/**
 * "Find the manifest file in this directory" for plugin discovery (`discovery.ts`
 * `findManifestPath`): the first of an ordered list of candidate locations that exists.
 */

/** A plugin's manifest: Claude Code's `.claude-plugin/plugin.json`, and nothing else. */
export const PLUGIN_MANIFEST_CANDIDATES: readonly string[] = [PLUGIN_MANIFEST]

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
