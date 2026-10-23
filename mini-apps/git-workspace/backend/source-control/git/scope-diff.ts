/**
 * Whole-tree scope diffs for the `git` RESOURCE provider (not per-file): the
 * STAGED set (`git diff --cached`), the UNSTAGED set (`git diff`), and a BRANCH
 * vs its base (`git diff <base>...<branch>`, i.e. changes since the branch
 * diverged). These back the `staged` / `unstaged` / branch-leaf review targets so
 * a `localix://resource/git/…` node expands to exactly the diff the user picked.
 *
 * Each read goes through `diff-read.ts`, so an overflow reports `truncated` with
 * its complete leading files; it used to read as a failure and render "Nothing
 * staged." over a change set too large to show.
 *
 * Kept in the git/ layer (not bootstrap) so all git-command logic stays here; each
 * fn takes a cwd and builds its own confined runner. Refs are guarded like the
 * rest of the git backend (no whitespace / leading `-`) before they reach git.
 */
import { gitRunner, type GitRunner } from './cli'
import { readDiff } from './diff-read'
import { isSafeRef } from './ref'

/** A scope's patch; `truncated` when it outgrew the capture ceiling. */
export interface ScopeDiff {
  diff: string
  truncated: boolean
}

async function readScope(cwd: string, args: string[]): Promise<ScopeDiff> {
  const read = await readDiff(gitRunner(cwd), args)
  return read.failed
    ? { diff: '', truncated: false }
    : { diff: read.diff, truncated: read.truncated }
}

/** The staged set — index vs HEAD. Empty diff when nothing is staged. */
export function getStagedDiff(cwd: string): Promise<ScopeDiff> {
  return readScope(cwd, ['diff', '--cached'])
}

/** The unstaged set — working tree vs index (tracked files only). */
export function getUnstagedDiff(cwd: string): Promise<ScopeDiff> {
  return readScope(cwd, ['diff'])
}

/**
 * A branch's changes vs its base — `git diff <base>...<branch>` (three-dot, so it
 * diffs from the merge-base, i.e. only what the branch added). The base is the
 * branch's upstream when set, else the first existing of origin/main·master,
 * main·master — skipping the branch itself. Returns null when no distinct base
 * resolves (e.g. an orphan branch) so the caller can fall back to a summary.
 */
export async function getBranchDiff(
  cwd: string,
  branch: string,
): Promise<(ScopeDiff & { base: string }) | null> {
  if (!isSafeRef(branch)) return null
  const base = await resolveBase(gitRunner(cwd), branch)
  if (!base) return null
  const scope = await readScope(cwd, ['diff', `${base}...${branch}`])
  return { base, ...scope }
}

/** The trunk candidates, in preference order, as display name → full ref. */
const TRUNKS: ReadonlyArray<readonly [name: string, ref: string]> = [
  ['origin/main', 'refs/remotes/origin/main'],
  ['origin/master', 'refs/remotes/origin/master'],
  ['main', 'refs/heads/main'],
  ['master', 'refs/heads/master'],
]

/**
 * ONE `for-each-ref` answers both questions — the branch's upstream and which
 * trunks exist — where it used to take an upstream `rev-parse` plus up to four
 * serial `rev-parse --verify` probes. Rows are keyed by FULL refname: a pattern is
 * a prefix match, so only an exact key proves that trunk exists.
 */
async function resolveBase(run: GitRunner, branch: string): Promise<string | null> {
  const own = `refs/heads/${branch}`
  const res = await run([
    'for-each-ref',
    '--format=%(refname)%00%(upstream:short)',
    own,
    ...TRUNKS.map(([, ref]) => ref),
  ])
  if (!res.ok) return null
  const rows = new Map<string, string>()
  for (const line of res.stdout.split('\n')) {
    const [ref, upstream = ''] = line.split('\0')
    if (ref) rows.set(ref, upstream)
  }
  // Prefer the branch's own upstream (e.g. origin/feature-x's base is its remote).
  const upstream = rows.get(own)
  if (upstream && upstream !== branch) return upstream
  // Else the repo's default trunk, skipping the branch itself.
  return TRUNKS.find(([name, ref]) => name !== branch && rows.has(ref))?.[0] ?? null
}
