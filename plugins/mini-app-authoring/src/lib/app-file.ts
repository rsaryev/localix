import { promises as fs } from 'node:fs'

import { isPathWithin, resolveWithin } from './paths'

/** Large enough for any store screenshot with room to report it oversized; smaller than a video. */
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024

/**
 * One regular file of a mini app, named by a path its manifest declares, or null. The path is
 * resolved inside the app's folder and checked again after links are followed, so neither `..`
 * nor a symlink planted in an app reaches a file outside it; a file over `maxBytes` is not read.
 */
export async function readAppFile(
  appDir: string,
  path: string,
  options: { maxBytes?: number } = {},
): Promise<Uint8Array | null> {
  const lexical = resolveWithin(appDir, path)
  if (!lexical) return null
  try {
    const [root, real] = await Promise.all([fs.realpath(appDir), fs.realpath(lexical)])
    if (!isPathWithin(root, real)) return null
    const info = await fs.stat(real)
    if (!info.isFile() || info.size > (options.maxBytes ?? DEFAULT_MAX_BYTES)) return null
    return new Uint8Array(await fs.readFile(real))
  } catch {
    return null
  }
}
