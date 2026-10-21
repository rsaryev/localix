// A hermetic environment for git in tests and capture fixtures. A git hook exports GIT_DIR,
// GIT_INDEX_FILE and friends and git honours them over `cwd`, so a test run from pre-commit in a
// worktree would commit, tag and configure the developer's own repository. Every scratch git call
// goes through this environment: no inherited GIT_* variable, no system or global config (no
// signing, hooks or templates), and a fixed identity — as git's own t/test-lib.sh does.

/** Removes every GIT_* variable in place and returns the same object. */
export function scrubGitEnv<T extends Record<string, string | undefined>>(env: T): T {
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  return env
}

/** A copy of `base` that is safe for git commands on a scratch repository. */
export function scratchGitEnv(
  base: Record<string, string | undefined> = process.env,
  extra: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    ...scrubGitEnv({ ...base }),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Localix test',
    GIT_AUTHOR_EMAIL: 'test@localix.invalid',
    GIT_COMMITTER_NAME: 'Localix test',
    GIT_COMMITTER_EMAIL: 'test@localix.invalid',
    ...extra,
  }
}
