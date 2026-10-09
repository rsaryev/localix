import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { isPathWithin } from '@localixai/path-containment'
import { MOTION_DIR } from '../shared/file-contract'

/** Resolve the workspace directory before opening any store or media file. */
export async function motionDirectory(workspace: string): Promise<string> {
  const root = await realpath(workspace)
  let dir = root
  for (const segment of MOTION_DIR.split('/')) {
    const next = join(dir, segment)
    await mkdir(next, { recursive: true, mode: 0o700 })
    dir = await realpath(next)
    if (!isPathWithin(root, dir)) throw new Error('Motion directory must stay inside the workspace')
  }
  return dir
}

export async function motionFile(dir: string, ...segments: string[]): Promise<string> {
  const path = join(dir, ...segments)
  try {
    if (!isPathWithin(dir, await realpath(path)))
      throw new Error('Motion file must stay inside its workspace')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return path
}
