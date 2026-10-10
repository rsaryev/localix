import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'
import { isPathWithin } from '@localixai/path-containment'
import { MOTION_DIR, projectIdSchema } from '../shared/contract'

/** Folders the CLI writes into; they do not change the film's revision. */
export const OUTPUT_DIRS = new Set(['renders', 'snapshots', 'node_modules', '.hyperframes'])

/** Resolve (and create) `.localix/motion` inside the workspace, refusing escapes. */
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

/** An existing project folder, or null. Refuses IDs and links that leave the motion directory. */
export async function projectDirectory(workspace: string, id: string): Promise<string | null> {
  if (!projectIdSchema.safeParse(id).success) return null
  const dir = await motionDirectory(workspace)
  try {
    const folder = await realpath(join(dir, id))
    if (!isPathWithin(dir, folder) || folder === dir) return null
    return (await stat(folder)).isDirectory() ? folder : null
  } catch {
    return null
  }
}

/** A file inside a project folder, or null when the path escapes it or does not exist. */
export async function projectFile(folder: string, path: string): Promise<string | null> {
  const target = resolve(folder, path)
  if (target !== folder && !target.startsWith(folder + sep)) return null
  try {
    const [root, real] = await Promise.all([realpath(folder), realpath(target)])
    return isPathWithin(root, real) && (await stat(real)).isFile() ? real : null
  } catch {
    return null
  }
}

export interface FileInfo {
  path: string
  bytes: number
  mtime: number
}
/** Every file under `folder` (relative paths), skipping hidden entries and output folders. */
export async function listFiles(folder: string, limit = 2000): Promise<FileInfo[]> {
  const files: FileInfo[] = []
  const walk = async (dir: string, depth: number) => {
    if (depth > 6 || files.length >= limit) return
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      const rel = relative(folder, path)
      if (entry.isDirectory()) {
        if (depth === 0 && OUTPUT_DIRS.has(entry.name)) continue
        await walk(path, depth + 1)
      } else if (entry.isFile()) {
        const info = await stat(path).catch(() => null)
        if (info)
          files.push({ path: rel.split(sep).join('/'), bytes: info.size, mtime: info.mtimeMs })
      }
    }
  }
  await walk(folder, 0)
  return files
}

/** Changes whenever any source file is added, removed or edited. */
export const revisionOf = (files: FileInfo[]) =>
  createHash('sha256')
    .update(files.map((file) => `${file.path}:${file.bytes}:${Math.round(file.mtime)}`).join('\n'))
    .digest('hex')
    .slice(0, 16)

export async function readText(path: string, max = 2_000_000): Promise<string | null> {
  try {
    if ((await stat(path)).size > max) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
