import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { writeGeneratedFile } from '../lib/generated-file'
import { KIT_CATALOG_FILE } from '../scaffold/prose'
import type { Kit } from './kit'

/**
 * Give a mini app the kit catalog as `KIT.md` in its own folder. The agent that builds a mini app is
 * told only its folder, so the catalog it chooses controls from has to be IN that folder, and
 * current: written on scaffold and on every check, the way `tsconfig.json` is.
 */
export async function writeKitCatalog(kit: Kit, miniAppDir: string): Promise<void> {
  const catalog = kit.manifest.authoring.catalog
  if (!catalog) return
  const text = await fs.readFile(join(kit.dir, catalog), 'utf8')
  await writeGeneratedFile(join(miniAppDir, KIT_CATALOG_FILE), text, KIT_CATALOG_FILE)
}
