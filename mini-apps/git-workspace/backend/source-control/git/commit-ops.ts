/**
 * Commit-level git actions addressed by hash — revert, reset, cherry-pick,
 * checkout (detached), and branch-at. Each surfaces git's own message on failure
 * (as a 409) so the UI can show exactly why an operation was refused; the two
 * sequencer ops (revert, cherry-pick) get a DISTINCT conflict code so the UI can
 * explain the working tree now holds conflict markers to resolve. Mirrors the
 * style of `actions.ts` — the backend adapter binds a runner and delegates here.
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { ResetMode } from '../contracts'
import { firstLine, type GitRunner } from './cli'

/**
 * Revert a commit — `git revert --no-edit <hash>` — creating a NEW commit that
 * undoes its changes (history-preserving, unlike reset). On a conflict git stops
 * mid-revert leaving conflict markers + `REVERT_HEAD`; that's surfaced as a
 * distinct `git_revert_conflict` so the UI can tell the user to resolve the
 * conflicts (in the Changes tree) and commit — or discard to abort.
 */
export async function revertCommit(run: GitRunner, hash: string): Promise<void> {
  const res = await run(['revert', '--no-edit', hash])
  if (!res.ok) {
    const message = firstLine(res.stderr) || firstLine(res.stdout) || `Could not revert ${hash}.`
    if (/conflict/i.test(res.stderr + res.stdout)) {
      throw new ApiError(409, 'git_revert_conflict', message)
    }
    throw new ApiError(409, 'git_revert_failed', message)
  }
}

/**
 * Cherry-pick a commit onto the current branch — `git cherry-pick <hash>` —
 * replaying its changes as a new commit here. On a conflict git stops leaving
 * markers + `CHERRY_PICK_HEAD`; surfaced as a distinct `git_cherry_pick_conflict`
 * so the UI can guide resolution (resolve + commit, or discard to abort).
 */
export async function cherryPick(run: GitRunner, hash: string): Promise<void> {
  const res = await run(['cherry-pick', hash])
  if (!res.ok) {
    const message =
      firstLine(res.stderr) || firstLine(res.stdout) || `Could not cherry-pick ${hash}.`
    if (/conflict/i.test(res.stderr + res.stdout)) {
      throw new ApiError(409, 'git_cherry_pick_conflict', message)
    }
    throw new ApiError(409, 'git_cherry_pick_failed', message)
  }
}

/**
 * Move the current branch to a commit — `git reset --<mode> <hash>`. `soft` keeps
 * the index+working tree (the diff since `hash` becomes staged); `mixed` resets
 * the index too (changes unstaged, working tree kept); `hard` also overwrites the
 * working tree (DESTRUCTIVE — uncommitted work is discarded). The mode is a fixed
 * enum (validated at the route), never interpolated, so it can't smuggle args.
 */
export async function resetToCommit(run: GitRunner, hash: string, mode: ResetMode): Promise<void> {
  const res = await run(['reset', `--${mode}`, hash])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_reset_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || `Could not reset to ${hash}.`,
    )
  }
}

/**
 * Check out a commit directly — `git checkout <hash>` — detaching HEAD (no branch
 * is current afterwards). git refuses with a dirty tree that would be overwritten;
 * its message is surfaced as a 409 (`git_checkout_failed`, matching branch checkout).
 * The caller re-reads status, whose `detached` flag now reflects the new state.
 */
export async function checkoutCommit(run: GitRunner, hash: string): Promise<void> {
  const res = await run(['checkout', hash])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_checkout_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || `Could not check out ${hash}.`,
    )
  }
}

/**
 * Create a new branch pointing at a specific commit WITHOUT switching to it —
 * `git branch <name> <hash>`. git validates the name (`check-ref-format`) and
 * refuses a duplicate; either way its message is surfaced as a 409
 * (`git_branch_create_failed`, matching create-off-HEAD). HEAD is unchanged.
 */
export async function createBranchAt(run: GitRunner, name: string, hash: string): Promise<void> {
  const res = await run(['branch', name, hash])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_branch_create_failed',
      firstLine(res.stderr) || `Could not create "${name}".`,
    )
  }
}
