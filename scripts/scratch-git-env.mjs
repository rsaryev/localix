// Git fixtures in tests and capture scripts must never reach the surrounding repository. A git
// hook exports GIT_DIR, GIT_INDEX_FILE and friends, and git honours them over `cwd`, so a test run
// from pre-commit in a worktree would commit, tag and configure the developer's own repository.
// Every scratch git call goes through this environment: no inherited GIT_* variable, no system or
// global config, and a fixed identity.

/**
 * Removes every GIT_* variable in place and returns the same object.
 * @template {Record<string, string | undefined>} T
 * @param {T} env
 * @returns {T}
 */
export function scrubGitEnv(env) {
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  return env
}

/**
 * A copy of `base` that is safe for git commands on a scratch repository.
 * @param {Record<string, string | undefined>} [base]
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string | undefined>}
 */
export function scratchGitEnv(base = process.env, extra = {}) {
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
