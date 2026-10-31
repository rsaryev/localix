import { InvalidRequestError } from '../../../lib/domain-errors'
import fs from 'node:fs/promises'
import path from 'node:path'

import { envString, localixHome } from '../../../lib/env'
import { isPathWithin } from '../../../lib/path-containment'

/**
 * Refuse moving/copying a FOLDER into itself or one of its own descendants — the
 * operation would recurse forever / corrupt the tree (yazi's `try_starts_with`).
 * No-op for a file source (a file has no subtree to loop into). Throws a typed 400
 * the UI surfaces.
 *
 * ROOT-INCLUSIVE ON PURPOSE ({@link isPathWithin}, not `isPathBelow`). The container
 * here is the SOURCE folder and the candidate is the destination directory, and
 * "destination IS the source" is not an edge case to wave through — it is the loop in
 * its purest form: `cp -R -- /a/b /a/b` copies the tree into itself. `isPathBelow`
 * answers false for the equal case by design (its callers are asking "is this a MEMBER
 * of the managed root I am about to delete?"), so using it here would open the guard on
 * the very case it exists to close. The predicate a mutating caller picks is the
 * behaviour, so it is picked deliberately, not by which copy was nearest.
 */
export function assertNotIntoSelf(source: string, destDir: string, isFolder: boolean): void {
  if (isFolder && isPathWithin(source, destDir))
    throw new InvalidRequestError(
      'refused',
      'Cannot move or copy a folder into itself or one of its subfolders',
    )
}

// ── Tree filesystem port ─────────────────────────────────────────────────────

/**
 * The primitive operations a file-tree mutation needs, answered in-process (a shell
 * round-trip per `[ -d ]`, `mkdir -p`, `mv` or `cp -R` made a trash move four process spawns).
 *
 * Kinds are those of the ENTRY: `kind`/`exists` never follow a symlink (a link to
 * a folder is a `file` entry, a dangling link exists), matching the Explorer's
 * listing. `isDir` follows, because it asks whether a paste TARGET can hold an
 * entry, and a link to a folder can.
 */
export interface TreeFs {
  kind(p: string): Promise<'dir' | 'file' | null>
  exists(p: string): Promise<boolean>
  isDir(p: string): Promise<boolean>
  mkdirp(dir: string): Promise<void>
  /** Create an empty file, creating its parent first; never truncates an existing one. */
  createFile(target: string): Promise<void>
  move(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  remove(p: string): Promise<void>
}

/** The node fs calls the local port uses — injectable so a test can force `EXDEV`. */
export type LocalTreeIo = Pick<
  typeof fs,
  'lstat' | 'stat' | 'mkdir' | 'writeFile' | 'rename' | 'cp' | 'rm'
>

const errorCode = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code

/**
 * `cp -R` semantics: recurse, copy a symlink AS a symlink with its target text
 * unchanged (`verbatimSymlinks` — the default rewrites a relative link to an
 * absolute one), and never overwrite (the caller proved the destination free).
 */
const COPY_OPTIONS = {
  recursive: true,
  verbatimSymlinks: true,
  errorOnExist: true,
  force: false,
} as const

export function createLocalTreeFs(io: LocalTreeIo = fs): TreeFs {
  const exists = async (p: string): Promise<boolean> => {
    try {
      await io.lstat(p)
      return true
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return false
      throw error
    }
  }
  const copy = async (from: string, to: string): Promise<void> => {
    try {
      await io.cp(from, to, COPY_OPTIONS)
    } catch (error) {
      // A half-written copy at a destination that was free is ours to clear;
      // leaving it would make the retry collide with debris.
      await io.rm(to, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }
  return {
    async kind(p) {
      try {
        return (await io.lstat(p)).isDirectory() ? 'dir' : 'file'
      } catch (error) {
        if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return null
        throw error
      }
    },
    exists,
    async isDir(p) {
      return io.stat(p).then(
        (value) => value.isDirectory(),
        () => false,
      )
    },
    async mkdirp(dir) {
      await io.mkdir(dir, { recursive: true })
    },
    async createFile(target) {
      await io.mkdir(path.dirname(target), { recursive: true })
      // `wx`: exclusive create, so a file that appeared since the caller's absence
      // check is refused rather than truncated.
      await io.writeFile(target, '', { flag: 'wx' })
    },
    async move(from, to) {
      try {
        await io.rename(from, to)
      } catch (error) {
        // rename(2) cannot cross filesystems — the trash under ~/.localix and a
        // workspace on another volume are the common case. `mv` falls back to
        // copy + delete there, so this does too: the source goes only once the
        // copy is complete.
        if (errorCode(error) !== 'EXDEV') throw error
        await copy(from, to)
        await io.rm(from, { recursive: true, force: true })
      }
    },
    copy,
    async remove(p) {
      await io.rm(p, { recursive: true, force: true })
    },
  }
}

/** The in-process port every file-tree mutation runs through. */
export const localTreeFs = createLocalTreeFs()

// ── Trash ────────────────────────────────────────────────────────────────────

/**
 * Absolute path of the local trash directory (`~/.localix/trash` by default,
 * overridable via `LOCALIX_TRASH_DIR` so tests don't pollute the real home). The
 * trash is where a deleted entry goes before it is gone.
 *
 * Read through {@link envString}, so a BLANK `LOCALIX_TRASH_DIR=` means unset and
 * the default still wins. On a raw `process.env.X ?? default` an empty string is
 * not nullish, so the trash root became `''` and `deleteEntry` would `mv` the
 * victim to a RELATIVE `<ts>-<name>` — i.e. dump the "deleted" file into the API
 * process's cwd — while still reporting `trashed: true`.
 */
export const trashDir = (): string =>
  envString('LOCALIX_TRASH_DIR') ?? path.join(localixHome(), 'trash')

/**
 * Collision-safe trash entry name for `<name>` deleted at `now` (ms epoch):
 * `<timestamp>-<name>`. `salt` disambiguates two deletes of the same name within
 * the same millisecond. Pure + testable.
 */
export const trashEntryName = (name: string, now: number, salt = ''): string =>
  `${now}${salt ? `-${salt}` : ''}-${name}`

// ── Atomic local write ────────────────────────────────────────────────────────

/**
 * Write `content` to `absPath` atomically on the LOCAL filesystem: write a temp
 * sibling then `rename` it over the target (rename is atomic within a filesystem),
 * so a crashed/interrupted save never leaves a half-written file. Only valid for a
 * real local path.
 */
export async function atomicWriteLocal(absPath: string, content: string): Promise<void> {
  const tmp = path.join(
    path.dirname(absPath),
    `.${path.basename(absPath)}.tmp-${process.pid}-${Date.now()}`,
  )
  try {
    await fs.writeFile(tmp, content)
    await fs.rename(tmp, absPath)
  } catch (err) {
    // Best-effort cleanup of the temp sibling on any failure.
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}
