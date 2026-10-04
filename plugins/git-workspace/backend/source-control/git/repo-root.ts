/**
 * Every git op runs at the repository's top level, never at the session cwd.
 *
 * The defect this stops: when the session cwd is a SUBFOLDER of the repo, the paths git
 * reports (status, `show --name-only`, a commit's file list) are root-relative, but a
 * `-- <path>` pathspec is read relative to the cwd. `git diff HEAD -- sub/f.txt` issued from
 * `sub/` matches nothing, so the file diff came back empty, stage/unstage/discard missed the
 * file, a hunk revert and the change-version fingerprint `stat`-ed the wrong path, and
 * `ls-files --others` listed only the cwd's subtree. `line-staging.ts` alone worked around it
 * with `-C <toplevel>` after a `rev-parse --show-toplevel` spawn per request.
 *
 * So the git backend is wrapped ONCE ({@link atRepoRoot}): each method receives the top level
 * in place of the cwd, and every runner, pathspec, `--no-index` path and filesystem join below
 * it is root-relative by construction — no call site can forget.
 *
 * The top level is found by walking up to the nearest `.git` entry (a directory, or the file
 * a linked worktree or submodule carries) — git's own discovery rule, at the cost of a few
 * `stat`s and no process. It is not cached: a `git init` in an intermediate directory would
 * make a cached answer silently retarget writes to the outer repo. A cwd with no `.git` above
 * it is returned unchanged, so git reports "not a repository" exactly as before. Unlike
 * `rev-parse --show-toplevel` the walk keeps the caller's spelling of the path (no symlink
 * resolution), so a root the UI compares against stays byte-identical.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { SourceControlBackend } from '../ports'

/** The nearest ancestor of `cwd` (itself included) holding a `.git` entry; else `cwd`. */
export function findRepoRoot(cwd: string): string {
  let dir = resolve(cwd)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}

/**
 * Re-point every method of a backend at the repo root. Every `SourceControlBackend` method
 * takes the cwd as its FIRST argument (the port's own convention); `id` is data and is kept.
 */
export function atRepoRoot(backend: SourceControlBackend): SourceControlBackend {
  const wrapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(backend)) {
    wrapped[key] =
      typeof value === 'function'
        ? (cwd: string, ...rest: unknown[]) => value(findRepoRoot(cwd), ...rest)
        : value
  }
  return wrapped as unknown as SourceControlBackend
}
