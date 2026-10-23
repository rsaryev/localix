/**
 * Resolve `.git`-relative names (`rebase-merge`, `BISECT_START`, `refs/bisect`,
 * …) to absolute paths.
 *
 * The correct-in-all-cases way is `git rev-parse --git-path <name>`, and that is
 * still the fallback — but it costs a process spawn per name, and the status
 * read asks for five of them on every poll tick. When the caller already knows
 * the per-worktree git dir (from {@link RepoContext}), joining is exact for
 * every per-worktree name this mini app reads and costs nothing.
 *
 * Two callers shared a byte-identical private copy of the spawn version before
 * this module existed (`rebase.ts` and `bisect.ts`); they now share this one.
 */
import { resolve } from 'node:path'
import type { GitRunner } from './cli'

/** Resolves one `.git`-relative name, or null when git can't answer. */
export type GitPathResolver = (rel: string) => Promise<string | null>

/**
 * Build a resolver. With `gitDir` (an absolute per-worktree `.git` directory)
 * every lookup is a pure join; without it each lookup asks git.
 */
export function gitPathResolver(run: GitRunner, cwd: string, gitDir?: string): GitPathResolver {
  if (gitDir) {
    const base = resolve(cwd, gitDir)
    return (rel) => Promise.resolve(resolve(base, rel))
  }
  return async (rel) => {
    const res = await run(['rev-parse', '--git-path', rel])
    return res.ok ? resolve(cwd, res.stdout.trim()) : null
  }
}
