// The environment every git spawn gets: no inherited repository, no interactive prompt.
import { toolEnv } from '@localixai/mini-app-sdk/backend'

/**
 * Never let git block on an interactive prompt. Without this a missing
 * credential, an SSH passphrase, or an askpass helper would make git read
 * /dev/tty and hang this process forever — fatal for the boot stale-sweep and
 * any unattended worktree/source-control op. GIT_TERMINAL_PROMPT=0 disables the
 * terminal prompt; GIT_ASKPASS='' disables any GUI askpass helper.
 *
 * env REPLACES the child env. Built PER CALL from `toolEnv()` — the call-time env (after
 * bootstrap repaired PATH for a GUI launch) plus the install dirs a GUI app's PATH misses — so
 * git and what it spawns (credential/askpass helpers, ssh, gpg, hooks) are found; a module-level
 * const would freeze the bare launchd PATH into every git spawn.
 */
/**
 * The variables that tie git to ONE repository, as `git rev-parse --local-env-vars` lists them
 * (git clears the same set before it enters a submodule). Started from a git hook, a
 * `rebase --exec` or a terminal inside another repository, the app inherits them, and every
 * call would read, commit and configure THAT repository instead of the one in `cwd`.
 */
export const GIT_LOCAL_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  // Listed by git before 2.40, which still ships as Apple's /usr/bin/git.
  'GIT_INTERNAL_SUPER_PREFIX',
] as const

export function gitHardenedEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = toolEnv()
  for (const key of GIT_LOCAL_ENV_VARS) delete inherited[key]
  return {
    ...inherited,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    // An HTTP transfer under 1 KB/s for a full minute is dead, not slow: git aborts it itself,
    // long before the network ceiling, and a transfer that is still moving is never touched.
    GIT_HTTP_LOW_SPEED_LIMIT: '1000',
    GIT_HTTP_LOW_SPEED_TIME: '60',
    // Callers may layer on top (e.g. GIT_SEQUENCE_EDITOR/GIT_EDITOR for a
    // non-interactive rebase). Spread LAST so an explicit override wins.
    ...extra,
  }
}
