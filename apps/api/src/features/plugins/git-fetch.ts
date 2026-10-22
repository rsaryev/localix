import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { childEnvNonInteractive } from '../../lib/login-shell-env'
import { rmrf } from '../ext/install-tree'

const execFileAsync = promisify(execFile)

/** Where a git checkout lands: a branch, tag or commit, and optionally one subdirectory. */
export interface GitCheckoutTarget {
  /** A branch, a tag, or a commit SHA (full or abbreviated). Absent: the default branch. */
  ref?: string
  /** Check out only this directory (Claude Code's `git-subdir` sparse checkout). */
  sparse?: string
}

const GIT_TIMEOUT_MS = 120_000

/** Variables that point git at another repository (a hook exports them); the fetch owns `dest`. */
const REPO_LOCATION_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

async function git(args: string[], cwd?: string): Promise<void> {
  // Never prompt: a host without stored credentials fails instead of waiting for a password.
  const env = childEnvNonInteractive()
  for (const key of REPO_LOCATION_VARS) delete env[key]
  await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, env, windowsHide: true })
}

/**
 * Fetch one revision of `url` into `dest`, as Claude Code does for a plugin source. A commit SHA
 * is fetched directly (most hosts serve a reachable commit even when its branch is gone); a
 * server that refuses a SHA, or an abbreviated one, falls back to fetching every branch and tag
 * and checking the commit out. With `sparse`, only that directory is checked out, over a partial
 * clone where the host supports one, so a plugin in a monorepo skips the rest of the repository.
 */
export async function fetchGitTree(
  url: string,
  dest: string,
  target: GitCheckoutTarget = {},
): Promise<void> {
  try {
    await rmrf(dest)
    await fs.mkdir(dest, { recursive: true })
    await git(['init', '--quiet', dest])
    await git(['remote', 'add', 'origin', url], dest)
    const filter = target.sparse ? ['--filter=blob:none'] : []
    if (target.sparse) {
      await git(['config', 'remote.origin.promisor', 'true'], dest)
      await git(['config', 'remote.origin.partialclonefilter', 'blob:none'], dest)
      await git(['sparse-checkout', 'set', '--', target.sparse], dest)
    }
    const want = target.ref ?? 'HEAD'
    try {
      await git(['fetch', '--quiet', '--depth', '1', ...filter, 'origin', want], dest)
      await git(['checkout', '--quiet', 'FETCH_HEAD'], dest)
    } catch (shallow) {
      if (!target.ref) throw shallow
      await git(
        [
          'fetch',
          '--quiet',
          ...filter,
          'origin',
          '+refs/heads/*:refs/remotes/origin/*',
          '+refs/tags/*:refs/tags/*',
        ],
        dest,
      )
      await git(['checkout', '--quiet', target.ref], dest)
    }
  } catch (err) {
    await rmrf(dest)
    throw new InvalidRequestError('plugin_clone_failed', `git fetch failed: ${errorMessage(err)}`)
  }
}
