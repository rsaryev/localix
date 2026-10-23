import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { writeGeneratedFile } from './generated-file'
import type { MiniAppKit } from './kit'
import { MINI_APP_KIT_CATALOG } from './kit-layout'

/**
 * Give a user mini app the kit catalog as `KIT.md` in its own folder.
 *
 * The agent that builds a mini app is told only its folder — never a path outside it, because the
 * agent that was once handed the source checkout went on to edit the app. So the catalog it must
 * choose primitives from has to be IN that folder, and current: written on scaffold and on every
 * build, the way `tsconfig.json` is, so a kit that gained a module tells every mini app at its next
 * build. A kit staged before the catalog existed writes nothing.
 */
export async function writeMiniAppKitCatalog(kit: MiniAppKit, miniAppDir: string): Promise<void> {
  if (!kit.manifest.kitCatalog) return
  const text = await fs.readFile(join(kit.dir, kit.manifest.kitCatalog), 'utf8')
  await writeGeneratedFile(join(miniAppDir, MINI_APP_KIT_CATALOG), text, MINI_APP_KIT_CATALOG)
}
