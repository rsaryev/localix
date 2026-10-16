/**
 * The environment for a git command aimed at a SCRATCH repository, from inside a git hook.
 *
 * A hook inherits the variables that tell git which repository it is in — `GIT_DIR` (absolute in a
 * linked worktree), `GIT_INDEX_FILE`, `GIT_WORK_TREE` — and git honours them over `-C <dir>` and
 * over the directory `git init` is given. The vendor sync (then `sync-vendor-pi.ts`) ran from
 * `pre-commit` and built its upstream checkouts in a temp directory, so from a worktree its `git init <tmp>` re-initialized
 * the SHARED repository instead: `core.bare` flipped to true and every checkout of the repository
 * stopped working. Only the `remote add origin` after it failing (the shared repo already has an
 * origin) kept the sparse checkout and `checkout FETCH_HEAD` from landing on it too.
 *
 * So every command whose target is a scratch repository runs with these variables removed, and git
 * finds the repository from the directory it was pointed at, the way it does outside a hook.
 */
const REPOSITORY_LOCATING = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
] as const

export function scratchGitEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if ((REPOSITORY_LOCATING as readonly string[]).includes(key)) continue
    out[key] = value
  }
  return out
}
