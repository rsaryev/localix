import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { ENVIRONMENTS_DIR } from './environments'
import { REQUEST_EXT } from './paths'

/** Depth cap for the walk: a collection is a human-maintained tree, not a filesystem. */
const MAX_DEPTH = 8

type TreeSelection = 'files' | 'folders'

async function walk(
  dir: string,
  root: string,
  depth: number,
  selection: TreeSelection,
): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  // Explicit UTF-8 keeps Dirent names typed as strings rather than buffers.
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return [] // Missing or unreadable collections are empty rather than fatal.
  }
  const found: string[] = []
  for (const entry of entries) {
    // Hidden entries and symlinks are never part of the collection traversal.
    if (entry.name.startsWith('.')) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Only the root environments folder is reserved: users/environments is ordinary.
      if (depth === 0 && entry.name === ENVIRONMENTS_DIR) continue
      if (selection === 'folders') {
        // Include the directory before descending, even at the traversal depth boundary.
        found.push(path.relative(root, absolute).split(path.sep).join('/'))
      }
      found.push(...(await walk(absolute, root, depth + 1, selection)))
    } else if (selection === 'files' && entry.isFile() && entry.name.endsWith(REQUEST_EXT)) {
      found.push(absolute)
    }
  }
  return found
}

/** Absolute request-file paths, in filesystem traversal order. */
export function walkCollectionFiles(root: string): Promise<string[]> {
  return walk(root, root, 0, 'files')
}

/** Relative collection folder names; the store owns their presentation ordering. */
export function walkCollectionFolders(root: string): Promise<string[]> {
  return walk(root, root, 0, 'folders')
}
