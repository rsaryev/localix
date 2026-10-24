import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'

import { MARKER_FILE, isManagedMarkerKind, type MARKER_KIND } from './managed-copy'

/**
 * The files the bundled mini app sync reads (`bundled-install.ts`): a source tree's content
 * fingerprint, the managed copy's marker that records it, and a manifest read that tells an absent
 * file from a broken one.
 */

interface ManagedMarker {
  kind: typeof MARKER_KIND
  fingerprint: string
}

/** A content hash of every entry under `root` (path, mode, bytes), the marker file excepted. */
export async function fingerprintTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === MARKER_FILE) continue
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      const stat = await fs.lstat(path)
      hash.update(`${rel}\0${stat.mode}\0`)
      if (entry.isDirectory()) {
        hash.update('directory\0')
        await visit(path)
      } else if (entry.isSymbolicLink()) {
        hash
          .update('symlink\0')
          .update(await fs.readlink(path))
          .update('\0')
      } else if (entry.isFile()) {
        hash
          .update('file\0')
          .update(await fs.readFile(path))
          .update('\0')
      } else {
        hash.update(`other\0${stat.size}\0${stat.mtimeMs}\0`)
      }
    }
  }
  await visit(root)
  return hash.digest('hex')
}

/**
 * A JSON file's value: `undefined` when the file is absent, `null` when it cannot be read or does
 * not parse (still a mini app: discovery reports why).
 */
export async function readJson(path: string): Promise<unknown> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export async function readMarker(dir: string): Promise<ManagedMarker | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(join(dir, MARKER_FILE), 'utf8'),
    ) as Partial<ManagedMarker>
    return isManagedMarkerKind(parsed.kind) && typeof parsed.fingerprint === 'string'
      ? (parsed as ManagedMarker)
      : null
  } catch {
    return null
  }
}
