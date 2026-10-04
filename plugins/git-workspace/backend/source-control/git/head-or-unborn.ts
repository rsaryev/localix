/**
 * Run a HEAD-relative git command, and its unborn-branch form only when HEAD is really missing.
 *
 * The defect: nine call sites spawned `rev-parse --verify HEAD` IN SERIES before their real
 * work, only to choose between `diff HEAD` and `diff` (or `restore --source=HEAD` and
 * `reset`). That is a whole process start on every file diff, hunk read, discard and amend,
 * to answer a question whose answer is "yes" in every repository with a commit.
 *
 * So the HEAD form runs first, and HEAD is probed only when it FAILED: with HEAD present the
 * failure is the real answer and is returned untouched; on an unborn branch the fallback
 * runs. The common case costs one spawn. The decision never reads git's stderr, whose wording
 * differs per subcommand and is translated under a non-English locale. Every HEAD form used
 * here fails before touching anything when HEAD cannot be resolved, so trying it first is
 * safe for the writes too.
 */
import type { GitRunner } from './cli'

/** True when HEAD resolves to a commit (false on an unborn branch). */
export async function hasHead(run: GitRunner): Promise<boolean> {
  return (await run(['rev-parse', '--verify', '--quiet', 'HEAD'])).ok
}

export async function withHeadOrUnborn<T>(
  run: GitRunner,
  attempt: (hasHead: boolean) => Promise<T>,
  failed: (result: T) => boolean,
): Promise<T> {
  const first = await attempt(true)
  if (!failed(first) || (await hasHead(run))) return first
  return attempt(false)
}
