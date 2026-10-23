/**
 * Branch listing + checkout for the git backend. Listing is read-only and
 * ordered by most-recently-committed; switching surfaces git's own error
 * (e.g. a dirty tree blocking checkout) as a 409 so the UI can show it verbatim.
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { RepoBranch, RepoRemoteBranch } from '../contracts'
import { firstLine, type GitRunner } from './cli'

/**
 * Tab-separated, one ref per line. `%(HEAD)` is "*" for the current branch;
 * `%(worktreepath)` is the absolute path of the worktree that has this branch
 * checked out (empty when no worktree holds it). A branch checked out in ANOTHER
 * worktree cannot be checked out here — git forbids the same branch in two trees.
 */
const FORMAT =
  '%(refname:short)%09%(HEAD)%09%(committerdate:relative)%09%(upstream:short)%09%(worktreepath)%09%(upstream:track,nobracket)'

/**
 * Parse git's `%(upstream:track,nobracket)` field into ahead/behind counts.
 * git emits `ahead 2, behind 1`, `ahead 2`, `behind 1`, `gone` (upstream deleted),
 * or an empty string (in sync, or no upstream). Anything we can't read → both 0.
 */
export function parseAheadBehind(track: string | undefined): { ahead: number; behind: number } {
  const ahead = track?.match(/ahead (\d+)/)
  const behind = track?.match(/behind (\d+)/)
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 }
}

export async function listBranches(run: GitRunner): Promise<RepoBranch[]> {
  const res = await run([
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${FORMAT}`,
    'refs/heads',
  ])
  if (!res.ok) return []
  const branches: RepoBranch[] = []
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue
    const [name, head, date, upstream, worktreePath, track] = line.split('\t')
    if (!name) continue
    const current = head?.trim() === '*'
    const wtPath = worktreePath?.trim() || undefined
    const { ahead, behind } = parseAheadBehind(track)
    branches.push({
      name,
      current,
      updatedAt: date?.trim() || undefined,
      upstream: upstream?.trim() || undefined,
      // Ahead/behind vs the tracking branch (0 when in sync or no upstream). Stale
      // until a fetch — the Pull/fetch action refreshes remote-tracking refs.
      ahead,
      behind,
      // Held by some OTHER worktree (not this cwd) → not switchable from here.
      worktreePath: !current ? wtPath : undefined,
    })
  }
  return branches
}

/**
 * Remote-tracking refs, tab-separated: short name, relative committer date. The
 * symbolic `origin/HEAD` alias is filtered out — it is a pointer, not a branch.
 */
const REMOTE_FORMAT = '%(refname:short)%09%(committerdate:relative)'

/**
 * Every remote-tracking branch. Read from the LOCAL remote-tracking refs, so it
 * costs one cheap `for-each-ref` and no network — and, like ahead/behind, it is
 * only as fresh as the last fetch.
 *
 * Which of these have no local counterpart is deliberately not decided here: the
 * caller already has the local list, and making this call wait for it would cost
 * a serial round trip on the panel's hottest read.
 */
export async function listRemoteBranches(run: GitRunner): Promise<RepoRemoteBranch[]> {
  const res = await run([
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${REMOTE_FORMAT}`,
    'refs/remotes',
  ])
  if (!res.ok) return []
  const out: RepoRemoteBranch[] = []
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue
    const [name, date] = line.split('\t')
    if (!name) continue
    const slash = name.indexOf('/')
    if (slash <= 0) continue
    const remote = name.slice(0, slash)
    const shortName = name.slice(slash + 1)
    // `origin/HEAD` is a symref to the remote's default branch, not a branch.
    if (shortName === 'HEAD') continue
    out.push({ name, remote, shortName, ...(date?.trim() ? { updatedAt: date.trim() } : {}) })
  }
  return out
}

/**
 * Check out a remote branch by creating the local tracking branch for it —
 * `git switch --track <remote>/<branch>`, which names the local branch after the
 * remote one and wires its upstream in a single step. Refuses (409, git's own
 * message) when the local name is taken, the tree is dirty, or the ref is gone.
 */
export async function checkoutRemoteBranch(run: GitRunner, remoteRef: string): Promise<void> {
  const res = await run(['switch', '--track', remoteRef])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_checkout_failed',
      firstLine(res.stderr) || `Could not check out "${remoteRef}".`,
    )
  }
}

/**
 * Merge `branch` into the current one. Defaults to git's own fast-forward-when-
 * possible behaviour; `noFastForward` always records a merge commit.
 *
 * A merge that stops on conflicts is NOT a failure to report and forget: git
 * leaves the merge in progress and the conflicted files show up in the Changes
 * tree, which is exactly where the user resolves them. So that case gets its own
 * code (`git_merge_conflict`) and the UI routes it to guidance rather than to a
 * red "merge failed". A refusal that changes nothing (dirty tree, unrelated
 * histories) stays `git_merge_failed`.
 */
export async function mergeBranch(
  run: GitRunner,
  branch: string,
  opts: { noFastForward?: boolean } = {},
): Promise<void> {
  const args = ['merge', '--no-edit']
  if (opts.noFastForward) args.push('--no-ff')
  const res = await run([...args, branch])
  if (res.ok) return
  const text = `${res.stdout}\n${res.stderr}`
  if (/conflict/i.test(text)) {
    // git narrates before it complains ("Auto-merging a.ts" comes first), so the
    // first line is the wrong one to show. Quote the CONFLICT line — it names the
    // file the user has to go and fix.
    const conflict = text
      .split('\n')
      .find((line) => /^CONFLICT/i.test(line.trim()))
      ?.trim()
    throw new ApiError(
      409,
      'git_merge_conflict',
      conflict || `Merging "${branch}" stopped on conflicts.`,
    )
  }
  throw new ApiError(
    409,
    'git_merge_failed',
    firstLine(res.stderr) || firstLine(res.stdout) || `Could not merge "${branch}".`,
  )
}

/**
 * Abandon an in-progress merge — `git merge --abort`, the escape hatch paired
 * with `git_merge_conflict`.
 */
export async function abortMerge(run: GitRunner): Promise<void> {
  const res = await run(['merge', '--abort'])
  if (!res.ok) {
    throw new ApiError(409, 'git_merge_failed', firstLine(res.stderr) || 'No merge to abort.')
  }
}

/**
 * Create a new branch off the current HEAD and switch to it — `git checkout -b
 * <name>`. git validates the name (`git check-ref-format` rules) and refuses a
 * name that already exists; either way its message is surfaced as a 409 so the
 * UI shows exactly why (invalid character, already exists, unborn HEAD, …).
 */
export async function createBranch(run: GitRunner, name: string): Promise<void> {
  const res = await run(['checkout', '-b', name])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_branch_create_failed',
      firstLine(res.stderr) || `Could not create "${name}".`,
    )
  }
}

/**
 * Rename branch `from` to `to` — `git branch -m <from> <to>` (works whether or
 * not `from` is the current branch). git refuses when `to` already exists (unless
 * forced, which we don't) or a name is invalid; its message is surfaced as a 409.
 * A branch checked out in ANOTHER worktree is not renamed from here (the caller
 * gates on `worktreePath`), matching the checkout restriction.
 */
export async function renameBranch(run: GitRunner, from: string, to: string): Promise<void> {
  const res = await run(['branch', '-m', from, to])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_branch_rename_failed',
      firstLine(res.stderr) || `Could not rename "${from}" to "${to}".`,
    )
  }
}

/**
 * Delete a local branch — `git branch -d <name>` (safe) or `-D` when `force`.
 * git itself refuses to delete the current branch or one checked out in another
 * worktree, and refuses `-d` on a branch not fully merged; each message is
 * surfaced verbatim. The not-fully-merged case gets its OWN code
 * (`git_branch_not_merged`) so the UI can offer a force retry instead of a dead
 * end — `force: true` reruns with `-D`.
 */
export async function deleteBranch(run: GitRunner, name: string, force: boolean): Promise<void> {
  const res = await run(['branch', force ? '-D' : '-d', name])
  if (!res.ok) {
    if (!force && /not fully merged/i.test(res.stderr)) {
      throw new ApiError(
        409,
        'git_branch_not_merged',
        firstLine(res.stderr) || `"${name}" is not fully merged.`,
      )
    }
    throw new ApiError(
      409,
      'git_branch_delete_failed',
      firstLine(res.stderr) || `Could not delete "${name}".`,
    )
  }
}

export async function switchBranch(run: GitRunner, branch: string): Promise<void> {
  const res = await run(['checkout', branch])
  if (!res.ok) {
    const stderr = firstLine(res.stderr)
    // Git refuses a branch already checked out in another worktree. Surface a
    // plain-language reason instead of the raw `fatal: '…' is already used by…`.
    if (/already used by worktree/i.test(res.stderr)) {
      throw new ApiError(
        409,
        'git_checkout_failed',
        `"${branch}" is checked out in another worktree, so it can't be switched to here. Open the session that runs on "${branch}" instead.`,
      )
    }
    throw new ApiError(409, 'git_checkout_failed', stderr || `Could not switch to "${branch}".`)
  }
}
