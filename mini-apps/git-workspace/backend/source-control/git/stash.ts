/**
 * Git stash ops for the source-control backend: list the stash stack and
 * create / apply / pop / drop entries. Listing is read-only; the mutating ops
 * surface git's own message on failure (as a 409) so the UI can show exactly why
 * an operation was refused (nothing to save, no such stash, a conflict on apply).
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { FileDiff, RepoStash } from '../contracts'
import { firstLine, type GitRunner } from './cli'
import { EMPTY_READ, readDiff, toFileDiff } from './diff-read'

/**
 * One record per line, unit-separated: `%gd` = the reflog selector `stash@{N}`,
 * `%cr` = relative committer date, `%s` = the stash subject. Subjects are a
 * single line, so a newline delimiter is safe.
 */
const FORMAT = '%gd%x1f%cr%x1f%s'

/** Extract the numeric stack index from a `stash@{N}` reflog selector. */
function parseIndex(selector: string): number | null {
  const m = /stash@\{(\d+)\}/.exec(selector)
  return m ? Number(m[1]) : null
}

/**
 * Pull the originating branch out of a stash subject. git writes either
 * `WIP on <branch>: <sha> <subject>` (auto message) or `On <branch>: <message>`
 * (explicit `-m`); both expose the branch after the `on ` prefix.
 */
function parseBranch(subject: string): string | undefined {
  const m = /^(?:WIP on|On) ([^:]+):/.exec(subject)
  return m ? m[1] : undefined
}

export async function listStashes(run: GitRunner): Promise<RepoStash[]> {
  const res = await run(['stash', 'list', `--format=${FORMAT}`])
  if (!res.ok) return []
  const stashes: RepoStash[] = []
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue
    const [selector, date, subject] = line.split('\x1f')
    const index = parseIndex(selector ?? '')
    if (index === null) continue
    stashes.push({
      index,
      message: subject ?? '',
      branch: parseBranch(subject ?? ''),
      relativeDate: date?.trim() || undefined,
    })
  }
  return stashes
}

/**
 * Save the working tree to a new stash — `git stash push` (+ `-u` to include
 * untracked, + `-m <message>` when labelled). git refuses when there's nothing to
 * save; that gets a distinct code (`git_stash_no_changes`) so the UI can show a
 * clean "nothing to stash" instead of a raw error.
 */
export async function createStash(
  run: GitRunner,
  opts: { message?: string; includeUntracked: boolean },
): Promise<void> {
  const args = ['stash', 'push']
  if (opts.includeUntracked) args.push('-u')
  if (opts.message?.trim()) args.push('-m', opts.message.trim())
  const res = await run(args)
  // git exits 0 with "No local changes to save" when the tree is clean — treat
  // it as a refusal regardless of exit code so the UI shows a clean message.
  if (
    /no local changes to save/i.test(res.stderr) ||
    /no local changes to save/i.test(res.stdout)
  ) {
    throw new ApiError(409, 'git_stash_no_changes', 'No changes to stash.')
  }
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_stash_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not stash changes.',
    )
  }
}

/**
 * Restore a stash onto the working tree — `git stash pop|apply stash@{index}`.
 * `pop` removes the entry on success; `apply` keeps it. git refuses when the
 * index is gone (`no_stash`) or the restore would clobber/conflict with current
 * changes (`git_stash_conflict`); each maps to a code the UI surfaces verbatim.
 */
export async function applyStash(run: GitRunner, index: number, pop: boolean): Promise<void> {
  const res = await run(['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
  if (!res.ok) {
    if (/no stash|is not a valid reference/i.test(res.stderr)) {
      throw new ApiError(409, 'git_stash_not_found', 'That stash no longer exists.')
    }
    if (/would be overwritten|^CONFLICT/im.test(res.stderr) || /^CONFLICT/m.test(res.stdout)) {
      throw new ApiError(
        409,
        'git_stash_conflict',
        firstLine(res.stderr) || 'Applying the stash conflicts with your current changes.',
      )
    }
    throw new ApiError(
      409,
      'git_stash_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not apply the stash.',
    )
  }
}

/**
 * The full patch of a stash entry — `git stash show -p stash@{index}` — as a
 * PURE unified-diff string (no log preamble) so DiffView renders it like a file
 * diff, mirroring `getCommitShow`. The index is a validated integer (never raw
 * user input), so the `stash@{N}` selector can't smuggle a flag; a bad ref →
 * empty diff (git `ok:false`), matching the tolerant by-hash show. The `path`
 * carries the selector as the diff tab's identity.
 */
export async function showStash(run: GitRunner, index: number): Promise<FileDiff> {
  const selector = `stash@{${index}}`
  // --include-untracked surfaces the untracked third-parent portion of a `-u`
  // stash (git ≥2.32); older gits reject the flag, so fall back to plain -p. Only
  // a REFUSAL retries: an overflow used to retry too, and come back empty.
  let read = await readDiff(run, ['stash', 'show', '-p', '--include-untracked', selector])
  if (read.failed) read = await readDiff(run, ['stash', 'show', '-p', selector])
  return toFileDiff(selector, read.failed ? EMPTY_READ : read)
}

/** Discard a stash entry — `git stash drop stash@{index}` (destructive). */
export async function dropStash(run: GitRunner, index: number): Promise<void> {
  const res = await run(['stash', 'drop', `stash@{${index}}`])
  if (!res.ok) {
    if (/no stash|is not a valid reference/i.test(res.stderr)) {
      throw new ApiError(409, 'git_stash_not_found', 'That stash no longer exists.')
    }
    throw new ApiError(
      409,
      'git_stash_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not drop the stash.',
    )
  }
}
