import { constants, type Stats } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { ConflictError } from '../../lib/domain-errors'

/**
 * Whether a project's folder is still where the project says it is.
 *
 * A folder goes away in ordinary life: it is renamed or moved, its disk is unplugged, a worktree is
 * deleted. Every consumer that WORKS in the folder (the file tree, file reads and writes, search,
 * the terminal, a chat turn, the live watcher, the language server) asks here first and refuses with
 * the one error below, so the person meets the same words everywhere instead of `ENOENT
 * posix_spawn '/bin/zsh'` in one place and a 404 in another. A consumer that only needs the path as
 * a key (the ownership check, discovery of settings and plugins) does not ask: a missing folder has
 * no project files, which is the truthful answer there.
 *
 * Nothing is cached about a folder being gone. Each question stats the disk again, so a folder that
 * comes back (the disk is plugged in again, the rename is undone) works at once without a restart.
 */
export type WorkspaceFolderState = 'present' | 'missing' | 'not_a_directory' | 'unreadable'

const REFUSAL: Record<Exclude<WorkspaceFolderState, 'present'>, { code: string; says: string }> = {
  missing: {
    code: 'workspace_folder_missing',
    says: 'The project folder was moved, renamed or deleted',
  },
  not_a_directory: {
    code: 'workspace_folder_not_a_directory',
    says: 'The project path is a file, not a folder',
  },
  unreadable: {
    code: 'workspace_folder_unreadable',
    says: 'Localix may not open the project folder',
  },
}

/**
 * The project's folder is not usable (HTTP 409).
 *
 * A conflict, not a 404: the session and the project both exist; what conflicts is the path they
 * record and the disk. `detail` is the recorded path, which the client shows and offers to locate.
 */
export class WorkspaceFolderUnavailableError extends ConflictError {
  readonly state: Exclude<WorkspaceFolderState, 'present'>

  constructor(state: Exclude<WorkspaceFolderState, 'present'>, dir: string) {
    super(REFUSAL[state].code, `${REFUSAL[state].says}: ${dir}`, dir)
    this.state = state
  }
}

/** What identifies a folder across a rename on its volume: its device, inode and birth time. */
interface FolderIdentity {
  dev: number
  ino: number
  birthtimeMs: number
}

/**
 * Identities of folders seen present, by path, in this process only.
 *
 * Kept in memory on purpose: it is enough to recognise a folder renamed while the app runs (the
 * common case: a rename in Finder with the app open), and it never writes the person's database.
 * After a restart a folder that was already gone has no identity, and nothing is suggested.
 */
const seen = new Map<string, FolderIdentity>()
const SEEN_LIMIT = 512

const identityOf = (info: Stats): FolderIdentity => ({
  dev: info.dev,
  ino: info.ino,
  birthtimeMs: info.birthtimeMs,
})

function remember(dir: string, identity: FolderIdentity): void {
  seen.delete(dir)
  seen.set(dir, identity)
  if (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value as string)
}

const denied = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EACCES' || code === 'EPERM'
}

/** Stat the folder (following a symlink: a link to a missing target is missing). */
export async function workspaceFolderState(dir: string): Promise<WorkspaceFolderState> {
  let info: Stats
  try {
    info = await stat(dir)
  } catch (error) {
    return denied(error) ? 'unreadable' : 'missing'
  }
  if (!info.isDirectory()) return 'not_a_directory'
  try {
    await access(dir, constants.R_OK | constants.X_OK)
  } catch {
    return 'unreadable'
  }
  remember(dir, identityOf(info))
  return 'present'
}

/** Refuse to work in a folder that is not there; see {@link WorkspaceFolderUnavailableError}. */
export async function assertWorkspaceFolder(dir: string): Promise<void> {
  const state = await workspaceFolderState(dir)
  if (state !== 'present') throw new WorkspaceFolderUnavailableError(state, dir)
}

/** How far the search for a moved folder looks: entries stat'ed in all. */
const SEARCH_BUDGET = 2_000
/** Folders the search never descends into: they are never a project's new home. */
const SKIPPED = new Set(['node_modules', 'Library', 'Applications'])

const sameFolder = (info: Stats, identity: FolderIdentity) =>
  info.dev === identity.dev &&
  info.ino === identity.ino &&
  // A file system with no birth time reports 0 on both sides; an inode reused by a new folder
  // has a later one.
  info.birthtimeMs === identity.birthtimeMs

const isDirectory = async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory()

/**
 * Where a folder this process saw went, when it can be told for certain: the same folder (same
 * device, inode and birth time) among the children and grandchildren of the nearest ancestor that
 * still exists. That covers a rename in place and a move under a renamed parent; a move across
 * disks makes a new folder and is not found.
 *
 * Never a guess by name or by repository: two clones of one repository share their root commit and
 * remote, and a folder of the same name is not the same folder. The caller offers the answer; it
 * never re-points a project on its own.
 */
export async function suggestMovedFolder(dir: string): Promise<string | null> {
  const identity = seen.get(dir)
  if (!identity || (await workspaceFolderState(dir)) !== 'missing') return null
  let base = path.dirname(dir)
  while (!(await isDirectory(base))) {
    const up = path.dirname(base)
    if (up === base) return null
    base = up
  }
  let budget = SEARCH_BUDGET
  let level = [base]
  for (let depth = 0; depth < 2 && level.length > 0; depth++) {
    const next: string[] = []
    for (const parent of level) {
      const entries = await readdir(parent, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (budget-- <= 0) return null
        // A symlink is not followed: the folder itself is what moved, and a link may loop.
        if (!entry.isDirectory()) continue
        const candidate = path.join(parent, entry.name)
        const info = await stat(candidate).catch(() => null)
        if (info && sameFolder(info, identity)) return candidate
        if (!entry.name.startsWith('.') && !SKIPPED.has(entry.name)) next.push(candidate)
      }
    }
    level = next
  }
  return null
}
