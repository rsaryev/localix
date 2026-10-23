import { useCallback, useState } from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import type { BisectTerm, RepoCommit, ResetMode } from '../../../backend/source-control/contracts'
import { MiniAppApiError } from '@localixai/mini-app-sdk/ui'
import { useSourceControlStore } from './store'
import { gitFailed } from './gitFailure'

const BISECT_MARK_LABEL: Record<BisectTerm, string> = { bad: 'bad', good: 'good', skip: 'skipped' }

/** A row worth posting on success — only for a result the graph itself does not show. */
interface CommitOpNotice {
  title: string
  description: string
}

/**
 * The commit-level git operations behind `CommitGraph`'s context menu — each is
 * "execute the store action" (whose `logVersion` bump re-reads the log) over a shared `run` wrapper that
 * busy-locks and maps sequencer/rebase conflicts to guidance rows.
 * Extracted from `CommitGraph` so the component keeps only its own view + dialog
 * state. Operations that need dialog input (branch-at, reword) stay in the
 * component; everything one-shot lives here.
 *
 * Reporting: a failure is `gitFailed(failure, err)`. A success posts nothing by default, because
 * the re-read log already shows it (the reverted/cherry-picked commit on top, HEAD moved, the new
 * branch label). `notice` is for the two that leave a state the graph cannot explain — a detached
 * HEAD and a started bisect — and it REPLACES the success row rather than joining it: the old
 * shape posted a success and an info for the same click, two rows for one fact.
 */
export function useCommitGraphOps(sessionId: string, branch: string | null, reload: () => void) {
  const [busy, setBusy] = useState(false)
  const store = useSourceControlStore.getState()

  const run = useCallback(
    async (fn: () => Promise<void>, failure: string, notice?: CommitOpNotice) => {
      if (busy) return
      setBusy(true)
      try {
        await fn()
        if (notice) toast.info(notice.title, { description: notice.description })
      } catch (err) {
        // A success needs no reload here: every graph op bumps `logVersion`, which the graph
        // already watches, so reloading on success too read the log twice per click. A failure
        // bumps nothing, yet a stopped rebase or cherry-pick has still moved HEAD — re-read it.
        reload()
        if (
          err instanceof MiniAppApiError &&
          (err.code === 'git_revert_conflict' ||
            err.code === 'git_cherry_pick_conflict' ||
            err.code === 'git_rebase_conflict')
        ) {
          toast.warning('Stopped on a conflict', {
            description:
              'Resolve the conflicts in the Changes tree, stage them, then Continue from the rebase banner — or Abort to back out.',
          })
        } else if (
          err instanceof MiniAppApiError &&
          (err.code === 'git_rebase_dirty' || err.code === 'git_rebase_nothing_staged')
        ) {
          // A precondition, not a failure: a transient answer naming what to fix. As a warning row
          // it outlived the moment by hours and counted toward the bell like a broken repository.
          toast.info(
            err.code === 'git_rebase_dirty'
              ? 'Commit or stash your changes first'
              : 'Stage some changes first',
          )
        } else {
          gitFailed(failure, err)
        }
      } finally {
        setBusy(false)
      }
    },
    [busy, reload],
  )

  const doCheckout = (c: RepoCommit) =>
    void run(() => store.checkoutCommit(sessionId, c.hash), `Could not check out ${c.shortHash}`, {
      title: `HEAD is now detached at ${c.shortHash}`,
      description: 'Create a branch here to keep new work.',
    })

  const doRevert = (c: RepoCommit) =>
    void run(() => store.revertCommit(sessionId, c.hash), `Could not revert ${c.shortHash}`)

  const doCherryPick = (c: RepoCommit) =>
    void run(() => store.cherryPick(sessionId, c.hash), `Could not cherry-pick ${c.shortHash}`)

  const doReset = (c: RepoCommit, mode: ResetMode) =>
    void run(
      () => store.resetToCommit(sessionId, c.hash, mode),
      `Could not reset to ${c.shortHash}`,
    )

  const doFixup = (c: RepoCommit) =>
    void run(() => store.fixupInto(sessionId, c.hash), `Could not fix up into ${c.shortHash}`)

  const doRebaseOnto = (c: RepoCommit) =>
    void run(
      () => store.rebaseOnto(sessionId, c.hash),
      `Could not rebase ${branch ?? 'the branch'} onto ${c.shortHash}`,
    )

  const doBisectStart = (c: RepoCommit) =>
    void run(
      () => store.bisectStart(sessionId, c.hash),
      `Could not start a bisect at ${c.shortHash}`,
      {
        title: `Bisect started at ${c.shortHash}`,
        description: `${c.shortHash} is marked bad. Mark an older commit good, then test each commit the bisect checks out.`,
      },
    )

  const doBisectMark = (c: RepoCommit, term: BisectTerm) =>
    void run(
      () => store.bisectMark(sessionId, term),
      term === 'skip'
        ? `Could not skip ${c.shortHash} in the bisect`
        : `Could not mark ${c.shortHash} ${BISECT_MARK_LABEL[term]}`,
    )

  const applyRebase = (fromHash: string, entries: Parameters<typeof store.interactiveRebase>[2]) =>
    void run(() => store.interactiveRebase(sessionId, fromHash, entries), 'Could not rebase')

  return {
    busy,
    run,
    doCheckout,
    doRevert,
    doCherryPick,
    doReset,
    doFixup,
    doRebaseOnto,
    doBisectStart,
    doBisectMark,
    applyRebase,
  }
}
