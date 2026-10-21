import { InvalidRequestError } from '../../../lib/domain-errors'
import fs from 'node:fs/promises'
import path from 'node:path'

import { envString, localixHome } from '../../../lib/env'
import { isPathWithin } from '../../../lib/path-containment'
import { shellQuote as shq, type ExecutionEnvironment } from '../../agent-core/tools/environment'

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

// ── Shell command builders (all paths quoted through `shellQuote`) ───────────

/**
 * Probe an ENTRY's kind in one call: prints `D` (dir), `F` (file), or `N` (absent).
 * `-L` is tested first because `[ -d ]` and `[ -e ]` FOLLOW symlinks: a link to a
 * folder was reported as a folder (so the into-self guard and the journal treated
 * the link as the tree it points at), and a dangling link was reported absent, so
 * it could be neither renamed nor deleted from the tree. A link is its own entry.
 */
export const probeKindCmd = (p: string): string =>
  `if [ -L ${shq(p)} ]; then printf F; elif [ -d ${shq(p)} ]; then printf D; ` +
  `elif [ -e ${shq(p)} ]; then printf F; else printf N; fi`

/**
 * Prints `__EXISTS__` when the entry exists (else nothing). A dangling symlink
 * exists: `[ -e ]` alone called it absent and a create/rename then replaced it.
 */
export const existsCmd = (p: string): string =>
  `if [ -e ${shq(p)} ] || [ -L ${shq(p)} ]; then printf __EXISTS__; fi`

/** Prints `D` when the path is an existing directory, else `N`. */
export const isDirCmd = (p: string): string =>
  `if [ -d ${shq(p)} ]; then printf D; else printf N; fi`

/** `mkdir -p` the given directory. */
export const mkdirCmd = (dir: string): string => `mkdir -p ${shq(dir)}`

/** Create an empty file, ensuring its parent directory exists first. */
export const touchFileCmd = (parent: string, target: string): string =>
  `mkdir -p ${shq(parent)} && : > ${shq(target)}`

/** Move/rename `from` → `to`. */
export const moveCmd = (from: string, to: string): string => `mv -- ${shq(from)} ${shq(to)}`

/** Recursively copy `from` → `to`. */
export const copyCmd = (from: string, to: string): string => `cp -R -- ${shq(from)} ${shq(to)}`

/** Recursively, forcibly remove `p` (permanent delete). */
export const removeCmd = (p: string): string => `rm -rf -- ${shq(p)}`

// ── Tree filesystem port ─────────────────────────────────────────────────────

/**
 * The primitive operations a file-tree mutation needs, one implementation per
 * backend. The local backend used to run every one of them through a spawned
 * shell (`[ -d ]`, `mkdir -p`, `mv`, `cp -R`) — a trash move was four process
 * spawns — although the files sit on this machine; it now answers in-process.
 * ssh/docker keep the shell, because their files are far-side.
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

/** The far-side port: the quoted command builders above, run in the session's shell. */
export function createShellTreeFs(env: Pick<ExecutionEnvironment, 'exec'>): TreeFs {
  const run = async (command: string, failure: string): Promise<string> => {
    const res = await env.exec(command)
    if (res.exitCode !== 0) throw new Error(res.stderr.trim() || failure)
    return res.stdout.trim()
  }
  return {
    async kind(p) {
      const probe = await run(probeKindCmd(p), `Could not inspect ${p}`)
      return probe === 'D' ? 'dir' : probe === 'F' ? 'file' : null
    },
    async exists(p) {
      return (await run(existsCmd(p), `Could not inspect ${p}`)) === '__EXISTS__'
    },
    async isDir(p) {
      return (await run(isDirCmd(p), `Could not inspect ${p}`)) === 'D'
    },
    async mkdirp(dir) {
      await run(mkdirCmd(dir), `Could not create ${dir}`)
    },
    async createFile(target) {
      await run(touchFileCmd(path.dirname(target), target), `Could not create ${target}`)
    },
    async move(from, to) {
      await run(moveCmd(from, to), `Could not move ${from}`)
    },
    async copy(from, to) {
      await run(copyCmd(from, to), `Could not copy ${from}`)
    },
    async remove(p) {
      await run(removeCmd(p), `Could not delete ${p}`)
    },
  }
}

const localTreeFs = createLocalTreeFs()

/** The port for a session's environment: in-process for local, the shell otherwise. */
export const treeFsFor = (env: Pick<ExecutionEnvironment, 'config' | 'exec'>): TreeFs =>
  env.config.kind === 'local' ? localTreeFs : createShellTreeFs(env)

// ── Trash ────────────────────────────────────────────────────────────────────

/**
 * Absolute path of the local trash directory (`~/.localix/trash` by default,
 * overridable via `LOCALIX_TRASH_DIR` so tests don't pollute the real home). The
 * trash is a LOCAL-backend concept only — ssh/docker sessions delete permanently.
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
 * real local path; the ssh/docker backends fall back to their generic writeFile.
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
