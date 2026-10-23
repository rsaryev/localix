import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isPathWithin } from '../../../lib/path-containment'

/** Generated output must never follow an app-controlled symlink outside the mini app folder. */
export async function assertSafeAuthoringPaths(pluginDir: string): Promise<void> {
  const pluginStat = await fs.lstat(pluginDir)
  if (!pluginStat.isDirectory() || pluginStat.isSymbolicLink()) {
    throw new Error(`Plugin folder is not a regular directory: ${pluginDir}`)
  }
  const root = await fs.realpath(pluginDir)
  for (const part of ['dist', 'dist/backend', 'dist/ui']) {
    const path = join(pluginDir, part)
    const stat = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!stat) continue
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Plugin output path is not a regular directory: ${part}`)
    }
    if (!isPathWithin(root, await fs.realpath(path))) {
      throw new Error(`Plugin output path escapes its folder: ${part}`)
    }
  }
}
