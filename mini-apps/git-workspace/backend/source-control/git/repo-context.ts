/**
 * The three facts almost every git read starts from — the working-tree root, the
 * per-worktree `.git` directory, and whether HEAD exists (and at which sha).
 *
 * They used to be three separate `git rev-parse` invocations issued from three
 * different modules (`collectStatus` for the root, `collectNumstat` for "is
 * there a HEAD", `readRebaseState`/`getBisectState` for `--git-path`), and each
 * spawn costs ~10 ms of process startup regardless of how trivial the answer is.
 * `git rev-parse` accepts all of them in ONE invocation and prints one line per
 * request, in argument order, so this reads them together.
 *
 * `--verify --quiet HEAD` is deliberately last: on an unborn branch git exits 1
 * WITHOUT printing a sha, but it has already printed the two paths, and `runGit`
 * hands back stdout on a non-zero exit — so the failure degrades to `head: null`
 * instead of losing the paths. Nothing here rejects.
 */
import type { GitRunner } from './cli'

export interface RepoContext {
  /** Absolute working-tree top level, or null when it can't be resolved. */
  root: string | null
  /**
   * Absolute per-worktree `.git` directory. Joining a `.git`-relative name onto
   * it is equivalent to `git rev-parse --git-path <name>` for every per-worktree
   * path this mini app reads (`rebase-merge`, `rebase-apply`, `BISECT_*`,
   * `refs/bisect`) — verified against a linked worktree. Do NOT join names that
   * live in the COMMON dir (`refs/heads`, `packed-refs`, `config`); those differ
   * in a linked worktree and still need `--git-path`.
   */
  gitDir: string | null
  /** Full sha of HEAD, or null on an unborn branch (no commits yet). */
  head: string | null
}

const EMPTY: RepoContext = { root: null, gitDir: null, head: null }

/** The argv that produces the three lines {@link parseRepoContext} reads. */
export const REPO_CONTEXT_ARGS = [
  'rev-parse',
  '--show-toplevel',
  '--absolute-git-dir',
  '--verify',
  '--quiet',
  'HEAD',
]

/**
 * Parse the combined output (PURE). Lines are positional: toplevel, git dir,
 * HEAD sha. A short output simply leaves the later fields null — the unborn-HEAD
 * case is exactly a two-line output.
 */
export function parseRepoContext(stdout: string): RepoContext {
  const lines = stdout.split('\n').map((l) => l.trim())
  const root = lines[0] || null
  const gitDir = lines[1] || null
  const head = lines[2] && /^[0-9a-f]{40}$/i.test(lines[2]) ? lines[2] : null
  return { root, gitDir, head }
}

/** Read {@link RepoContext} with a single git invocation. Never throws. */
export async function readRepoContext(run: GitRunner): Promise<RepoContext> {
  const res = await run(REPO_CONTEXT_ARGS)
  // A hard failure (not a repo at all) leaves stdout empty; parse handles it.
  if (!res.stdout) return EMPTY
  return parseRepoContext(res.stdout)
}
