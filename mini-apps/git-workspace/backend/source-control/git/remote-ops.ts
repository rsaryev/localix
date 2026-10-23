/**
 * The three operations that talk to a REMOTE — push, fast-forward pull, and
 * fetch.
 *
 * Split out of `actions.ts` for the repo's size ratchet, and the line is not
 * arbitrary: these are the only git calls here that leave the machine, which is
 * why `cli.ts` exempts them from its local wall-clock deadline (a slow network
 * is not a wedged git). Their failure vocabulary is remote-shaped too — auth,
 * "no upstream", a non-fast-forward rejection — where the rest of `actions.ts`
 * fails on the index.
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import { firstLine, type GitRunner } from './cli'

/**
 * Push the current branch. Tries `git push`; if the branch has no upstream yet,
 * retries with `-u origin HEAD` to create it. Surfaces git's message (no remote,
 * auth, non-fast-forward) as a 409 so the UI can show it verbatim.
 *
 * `force` switches to `--force-with-lease` — the safe rewrite-republish an amend
 * or rebase leaves you needing, and the retry the UI offers on `git_push_rejected`.
 */
export async function push(run: GitRunner, opts: { force?: boolean } = {}): Promise<void> {
  // `--force-with-lease` (never a bare `--force`): it refuses when the remote
  // moved since our last fetch, so a rewrite can overwrite OUR old commits but
  // not a colleague's new ones. That is the whole difference between "republish
  // the history I just rebased" and "silently delete someone else's work".
  const base = opts.force ? ['push', '--force-with-lease'] : ['push']
  let res = await run(base)
  if (!res.ok && /no upstream|set-upstream|has no upstream branch/i.test(res.stderr)) {
    res = await run([...base, '-u', 'origin', 'HEAD'])
  }
  if (!res.ok) {
    const text = `${res.stdout}\n${res.stderr}`
    // A rejected non-fast-forward is the ONE push failure with an obvious next
    // step (force-with-lease), so it gets a code the UI can offer that retry on
    // instead of a dead-end error.
    if (!opts.force && /non-fast-forward|fetch first|rejected/i.test(text)) {
      throw new ApiError(
        409,
        'git_push_rejected',
        firstLine(res.stderr) || firstLine(res.stdout) || 'The remote rejected this push.',
      )
    }
    throw new ApiError(
      409,
      'git_push_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Push failed.',
    )
  }
}

/**
 * Integrate the upstream branch into the current one, fast-forward only —
 * `git pull --ff-only`. This is the non-destructive half of "sync": it advances
 * the branch when it's strictly behind, and REFUSES (rather than creating a
 * surprise merge commit or leaving a half-finished rebase) when local and remote
 * have diverged. git's own message ("Not possible to fast-forward", "no tracking
 * information", auth failures) is surfaced verbatim as a 409 so the UI can show
 * exactly why — the user then rebases/merges via the worktree tooling.
 */
export async function pull(run: GitRunner): Promise<void> {
  const res = await run(['pull', '--ff-only'])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_pull_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Pull failed.',
    )
  }
}

/**
 * Refresh the remote-tracking refs without integrating anything — `git fetch
 * --prune`. This is what makes "behind N" (and so the Pull button) actually
 * surface: ahead/behind are read from the local remote-tracking ref, which is
 * stale until a fetch, so a strictly-behind branch looks up-to-date until the
 * user (or this) fetches. `--prune` drops refs for branches deleted upstream.
 * Purely read-only for the working tree; git's own error (no remote configured,
 * auth failure) is surfaced verbatim as a 409.
 */
export async function fetchRemote(run: GitRunner): Promise<void> {
  const res = await run(['fetch', '--prune'])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_fetch_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Fetch failed.',
    )
  }
}
