import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { listSubdirs } from '../ext/fs-discovery'
import { MARKER_FILE, MARKER_KIND } from './managed-copy'

/**
 * Before mini apps were their own format, Localix synchronized managed copies of the ones it
 * shipped into `~/.localix/plugins/`, marked `.localix-managed.json`. Those folders are neither a
 * plugin nor an installed mini app any more, so the start removes them; nothing else in that
 * folder is touched (`docs/internals/plugins-and-mini-apps.md`, "Migration"). Returns the names
 * it removed.
 */
export async function retireLegacyPluginCopies(homeDir: string): Promise<string[]> {
  const root = join(homeDir, '.localix', 'plugins')
  const removed: string[] = []
  for (const name of await listSubdirs(root)) {
    const dir = join(root, name)
    const marker = await fs
      .readFile(join(dir, MARKER_FILE), 'utf8')
      .then((text) => JSON.parse(text) as { kind?: unknown })
      .catch(() => null)
    if (marker?.kind !== MARKER_KIND) continue
    await fs.rm(dir, { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}
