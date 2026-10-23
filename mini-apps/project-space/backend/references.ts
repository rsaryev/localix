import { createHash } from 'node:crypto'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile, safeFileKey } from '@localixai/mini-app-sdk/backend'
import type { SpaceDocument } from '../shared/format/document'
import { resolveReference, spacePaths, toReference } from './paths'

/**
 * What the board's references point at on disk: whether each still exists, what a folder
 * holds, and where a pasted file is kept.
 *
 * None of the reference tools rewrites a board when a file is renamed, and an unanswered rename
 * leaves a card that silently shows nothing. So every read reports the elements whose path is
 * gone, and the card says so — the reference stays on the board until a person or the agent
 * points it at the new path or deletes it.
 */
export async function referenceStates(root: string, space: SpaceDocument) {
  const missing: string[] = []
  // When each referenced file last changed: a card that shows a file re-reads it when its stamp
  // moves, which is how an edit in the editor reaches the board without the board file changing.
  const stamps: Record<string, number> = {}
  await Promise.all(
    Object.entries(space.elements).map(async ([id, element]) => {
      const path = element.props.path
      if (typeof path !== 'string') return
      const target = resolveReference(root, path)
      const info = target ? await stat(target).catch(() => null) : null
      if (info) stamps[id] = Math.round(info.mtimeMs)
      else missing.push(id)
    }),
  )
  return { missing: missing.sort(), stamps }
}

export async function missingReferences(root: string, space: SpaceDocument): Promise<string[]> {
  return (await referenceStates(root, space)).missing
}

export interface FolderEntry {
  name: string
  kind: 'file' | 'folder'
}

const FOLDER_LIMIT = 200

/** A folder's entries, folders first, bounded — a card lists a folder, it does not index one. */
export async function listFolder(target: string) {
  const entries = await readdir(target, { withFileTypes: true })
  const listed: FolderEntry[] = entries
    .filter((entry) => entry.name !== '.git' && entry.name !== '.DS_Store')
    .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'folder' : 'file' }) as const)
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
    )
  return { entries: listed.slice(0, FOLDER_LIMIT), total: listed.length }
}

/**
 * Keep a pasted file (a screenshot has no path) in the board's `files/` folder and return the
 * reference to it. The name starts with the content's hash, so pasting the same image twice keeps
 * one file.
 */
export async function keepPastedFile(root: string, name: string, bytes: Uint8Array) {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
  const dot = name.lastIndexOf('.')
  const stem = safeFileKey(dot > 0 ? name.slice(0, dot) : name).slice(0, 48) || 'pasted'
  const extension = dot > 0 ? `.${safeFileKey(name.slice(dot + 1)).slice(0, 8)}` : ''
  const dir = spacePaths(root).files
  const target = join(dir, `${hash}-${stem}${extension}`)
  if (!(await stat(target).catch(() => null))) {
    await mkdir(dir, { recursive: true })
    await atomicWriteFile(target, bytes)
  }
  return toReference(root, target)
}
