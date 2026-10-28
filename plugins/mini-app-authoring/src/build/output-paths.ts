import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isPathWithin } from '../lib/paths'

/** Generated output must never follow an app-controlled symlink outside the mini app folder. */
export async function assertSafeAuthoringPaths(miniAppDir: string): Promise<void> {
  const miniAppStat = await fs.lstat(miniAppDir)
  if (!miniAppStat.isDirectory() || miniAppStat.isSymbolicLink()) {
    throw new Error(`Mini app folder is not a regular directory: ${miniAppDir}`)
  }
  const root = await fs.realpath(miniAppDir)
  for (const part of ['dist', 'dist/backend', 'dist/ui']) {
    const path = join(miniAppDir, part)
    const stat = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!stat) continue
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Mini app output path is not a regular directory: ${part}`)
    }
    if (!isPathWithin(root, await fs.realpath(path))) {
      throw new Error(`Mini app output path escapes its folder: ${part}`)
    }
  }
}
