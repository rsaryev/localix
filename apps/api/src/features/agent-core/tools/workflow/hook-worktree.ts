import { constants } from 'node:fs'
import { access, lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { isPathBelow } from '../../../../lib/path-containment'
import { createGitRunner, type AgentWorktree, type GitRunner } from './worktree'

/**
 * A workflow agent's worktree made by a Claude Code `WorktreeCreate` hook in place of
 * `git worktree add` (the hook runs in `cc-hooks/runtime-worktree-hooks.ts`). The path the hook
 * returned is screened as Claude Code screens it:
 *   - a relative path resolves against the folder the hook ran in, `.` and `..` collapsed;
 *   - an absolute path with a `.` or `..` segment is refused;
 *   - a path through a symlink below the repository root is refused, since a symlink committed
 *     to the repository could send the worktree out of it — the error names the component;
 *   - the result must be a folder Localix can enter.
 * The agent works at the path itself, and when it finishes the worktree is kept with nothing run
 * on it — no git removal, no branch deleted, no WorktreeRemove hook — as Claude Code keeps one.
 */

/** What the run's WorktreeCreate hooks answered (`cc-hooks` `WorktreeCreateResult`). */
export type WorktreeHookResult =
  | { ok: true; path: string; cwd: string }
  | { ok: false; error: string }

/** Run the WorktreeCreate hooks for one agent; undefined when none ran, so git makes it. */
export type WorktreeHook = (name: string) => Promise<WorktreeHookResult | undefined>

const refuse = (shown: string, why: string): Error =>
  new Error(`isolation: refused the WorktreeCreate hook's path "${shown}": ${why}`)

/** The hook's path made absolute, or the reason it is refused. */
export function resolveHookPath(raw: string, hookCwd: string): string {
  if (!path.isAbsolute(raw)) return path.resolve(hookCwd, raw)
  const dotted = raw.split(/[\\/]+/).find((segment) => segment === '.' || segment === '..')
  if (dotted) throw refuse(raw, `an absolute path may not contain a "${dotted}" segment`)
  return path.normalize(raw)
}

/**
 * The first component of `target` that is a symlink strictly below `repoRoot` (a real path), or
 * null. Symlinks above the repository (a `/var` → `/private/var`) are followed.
 */
export async function symlinkBelowRoot(target: string, repoRoot: string): Promise<string | null> {
  let shown = path.parse(target).root
  let real = shown
  for (const part of target.slice(shown.length).split(path.sep).filter(Boolean)) {
    shown = path.join(shown, part)
    const candidate = path.join(real, part)
    const entry = await lstat(candidate).catch(() => null)
    if (!entry) return null
    if (!entry.isSymbolicLink()) {
      real = candidate
      continue
    }
    if (isPathBelow(repoRoot, candidate)) return shown
    real = await realpath(candidate).catch(() => candidate)
  }
  return null
}

async function isEnterableDir(dir: string): Promise<boolean> {
  const found = await stat(dir).catch(() => null)
  if (!found?.isDirectory()) return false
  return access(dir, constants.X_OK).then(
    () => true,
    () => false,
  )
}

/** Adopt the worktree a WorktreeCreate hook made, or throw why it cannot be used. */
export async function adoptHookWorktree(
  made: WorktreeHookResult,
  git: GitRunner = createGitRunner(),
): Promise<AgentWorktree> {
  if (!made.ok) throw new Error(`isolation: ${made.error}`)
  const dir = resolveHookPath(made.path, made.cwd)
  // A folder outside git (an SVN or Perforce checkout) has no repository root to screen below.
  const top = await git(made.cwd, ['rev-parse', '--show-toplevel']).catch(() => '')
  if (top) {
    const link = await symlinkBelowRoot(dir, await realpath(top).catch(() => top))
    if (link) throw refuse(made.path, `${link} is a symlink inside the repository`)
  }
  if (!(await isEnterableDir(dir)))
    throw refuse(made.path, `${dir} is not a folder Localix can enter`)
  return {
    dir,
    workingDir: dir,
    byHook: true,
    finish: async () => ({ kept: true }),
  }
}
