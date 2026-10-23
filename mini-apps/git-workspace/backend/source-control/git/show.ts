/**
 * By-hash commit diff for the git backend. Returns the commit's full patch as a
 * PURE unified-diff string (no `commit/Author/Date` log preamble) so DiffView —
 * which parses hunks, not git's header — renders it exactly like a file diff.
 *
 * ONE spawn, `git show --format= -p --root --diff-merges=first-parent`. It used to
 * be two in series — a `rev-parse <hash>^` probe choosing between `diff <hash>^
 * <hash>` and `show --root` — and this one command prints the same bytes for all
 * three shapes: a normal commit, a root commit (patch against the empty tree), and
 * a merge (diff against its FIRST parent, what `<hash>^` meant). `^{commit}` peels
 * an annotated tag, whose `show` would otherwise print the tag message; the
 * trailing `--` keeps an unknown ref from being read as a path.
 *
 * A refused read returns an empty-diff `FileDiff`; an overflowing one returns its
 * complete leading files with `truncated`. The `path` carries the hash (the diff
 * tab's identity), mirroring how the per-file diff uses the file path.
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { FileDiff, RangeDiff } from '../contracts'
import { firstLine, type GitRunner } from './cli'
import { EMPTY_READ, readDiff, toFileDiff } from './diff-read'
import { isSafeRef } from './ref'

/** The argv of a commit's first-parent patch — exported so the parity test pins it. */
export function commitShowArgs(hash: string): string[] {
  return [
    'show',
    '--no-show-signature',
    '--format=',
    '-p',
    '--root',
    '--diff-merges=first-parent',
    `${hash}^{commit}`,
    '--',
  ]
}

export async function getCommitShow(run: GitRunner, hash: string): Promise<FileDiff> {
  if (!isSafeRef(hash)) return toFileDiff(hash, EMPTY_READ)
  const read = await readDiff(run, commitShowArgs(hash))
  return toFileDiff(hash, read.failed ? EMPTY_READ : read)
}

/**
 * The repo-relative paths a commit touched, newest-first order as git emits them.
 * `git show --name-only --format=` drops the log preamble and works for a root
 * commit too (unlike bare `diff-tree`, which needs `--root`). Guards the ref like
 * `getCommitShow`; never throws — a bad ref / failed run yields `[]`.
 */
export async function getCommitFiles(run: GitRunner, hash: string): Promise<string[]> {
  if (!isSafeRef(hash)) return []
  const res = await run(['show', '--name-only', '--format=', hash])
  if (!res.ok) return []
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * The single-file patch of one path within a commit — `git show --format= <hash>
 * -- <path>` — as a pure unified-diff string (no commit-log preamble). The `--`
 * separator makes a path starting with `-` safe from flag injection. Guards the
 * ref + rejects an empty path; never throws (failed run → empty string).
 */
export async function getCommitFileDiff(
  run: GitRunner,
  hash: string,
  path: string,
): Promise<string> {
  if (!isSafeRef(hash) || !path) return ''
  const res = await run(['show', '--format=', hash, '--', path])
  return res.ok ? res.stdout : ''
}

/**
 * The diff between two commits — `git diff <from> <to>` (two-dot, default) or
 * `git diff <from>...<to>` (three-dot: what changed on `to` since its merge base
 * with `from`) — as a PURE multi-file unified-diff string, plus a compact
 * `--shortstat` summary. Both refs are flag-guarded like `getCommitShow`; UNLIKE
 * the by-hash show (which returns an empty diff for a bad ref), a bad ref here is
 * a caller error surfaced as a typed 400, and an unresolvable ref git rejects
 * surfaces as a 409 with git's own message — a compare is an explicit action the
 * UI should explain when it can't run.
 */
export async function getRangeDiff(
  run: GitRunner,
  from: string,
  to: string,
  threeDot = false,
): Promise<RangeDiff> {
  if (!isSafeRef(from) || !isSafeRef(to)) {
    throw new ApiError(400, 'git_bad_ref', 'Invalid commit reference for compare.')
  }
  // Two args for two-dot; a single `A...B` token for three-dot. Refs are guarded
  // (no leading dash / whitespace) so neither can smuggle a flag.
  const rangeArgs = threeDot ? [`${from}...${to}`] : [from, to]
  // The stat is independent of the patch, so both spawn at once. An overflowing
  // patch is not a refusal: it keeps its complete leading files and the stat still
  // counts the whole range (a 409 here used to carry the first diff line as its message).
  const [read, statRes] = await Promise.all([
    readDiff(run, ['diff', ...rangeArgs]),
    run(['diff', '--shortstat', ...rangeArgs]),
  ])
  if (read.failed) {
    throw new ApiError(
      409,
      'git_range_failed',
      firstLine(read.stderr) || `Could not diff ${from}..${to}.`,
    )
  }
  return {
    ...toFileDiff(`${from.slice(0, 7)}..${to.slice(0, 7)}`, read),
    from,
    to,
    stat: statRes.ok ? statRes.stdout.trim() : '',
    threeDot,
  }
}
