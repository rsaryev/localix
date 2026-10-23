import { useCallback, useMemo, useState } from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import type { ActionFeedbackInput, ActionFeedbackStore } from '@localixai/kit/action-feedback'
import { useSessionGitField, useSourceControlStore } from '../model/store'
import { gitFailed } from '../model/gitFailure'
import { MiniAppApiError } from '@localixai/mini-app-sdk/ui'

/**
 * Every branch command the panel offers, plus the concurrency and refusals they
 * share. Floating-surface state belongs to the consumer; this hook owns only Git
 * command concurrency, validation and user-facing outcomes.
 *
 * BUSY IS PER BRANCH, not per section. A single `busy` flag disabled every row
 * while any one of them was working, so deleting a branch froze the whole list —
 * and, because each op used to be followed by a full workspace re-read, it stayed
 * frozen for as long as the slowest poll. The op is scoped to one branch, so the
 * disabled state is too; only the ops that genuinely take the whole list offline
 * (creating, renaming) hold `busy`.
 *
 * Reporting: switch, create, rename, delete and remote checkout post nothing on success — the
 * branch pill and this list already show the result. A merge does post: a fast-forward changes
 * nothing this list renders. Refusals the rows already disable (current branch, a branch held
 * by another worktree) stay as `info` for the callers that reach them without a row.
 */
export function useBranchSwitcher(sessionId: string | null, anchor?: ActionFeedbackStore) {
  // An answer to the person's own branch action ("already exists", "Merged x") is transient and
  // never a journal row. The Branches section renders it beside itself (`anchor`); the titlebar and
  // composer menus close as they fire and have nowhere to render one, so theirs takes the host's
  // transient line through `toast.info`/`toast.success` instead of vanishing into an unseen store.
  const feedback = {
    show: (message: string, input?: ActionFeedbackInput) => {
      if (anchor) return anchor.show(message, input)
      const publish = input?.tone === 'success' ? toast.success : toast.info
      publish(message, input?.detail ? { description: input.detail } : undefined)
    },
  }
  // Two narrow reads instead of the whole slice: this hook runs three times at once (the titlebar
  // and composer status items, the Branches section), and the slice changes on every poll that
  // touches any file. The current branch is a primitive, so a file edit re-renders none of them.
  const currentBranch = useSourceControlStore((s) =>
    sessionId ? (s.bySession[sessionId]?.status?.branch ?? null) : null,
  )
  const branches = useSessionGitField(sessionId, 'branches')
  const switchBranch = useSourceControlStore((s) => s.switchBranch)
  const createBranch = useSourceControlStore((s) => s.createBranch)
  const renameBranch = useSourceControlStore((s) => s.renameBranch)
  const deleteBranch = useSourceControlStore((s) => s.deleteBranch)
  const mergeBranchOp = useSourceControlStore((s) => s.mergeBranch)
  const checkoutRemote = useSourceControlStore((s) => s.checkoutRemoteBranch)
  const [switching, setSwitching] = useState<string | null>(null)
  /** Names with an op in flight — the rows that disable, and only those. */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const list = useMemo(() => branches?.branches ?? [], [branches])
  const remotes = useMemo(() => branches?.remotes ?? [], [branches])

  const mark = useCallback((name: string, on: boolean) => {
    setPending((prev) => {
      if (prev.has(name) === on) return prev
      const next = new Set(prev)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })
  }, [])

  /** Run one branch-scoped op with its row marked busy; `false` on failure. */
  const runFor = async (name: string, op: () => Promise<void>): Promise<boolean> => {
    if (!sessionId || pending.has(name)) return false
    mark(name, true)
    try {
      await op()
      return true
    } finally {
      mark(name, false)
    }
  }

  const onPick = async (name: string): Promise<boolean> => {
    if (!sessionId || switching) return false
    if (name === currentBranch) return true
    // A branch held by another worktree (e.g. `main` in the primary checkout)
    // can't be checked out here — git forbids the same branch in two trees.
    const target = list.find((b) => b.name === name)
    if (target?.worktreePath) {
      feedback.show(`"${name}" is open in another worktree`, {
        detail: 'Open the conversation that runs on it to work there',
      })
      return false
    }
    setSwitching(name)
    try {
      await switchBranch(sessionId, name)
      return true
    } catch (err) {
      gitFailed(`Could not switch to ${name}`, err)
      return false
    } finally {
      setSwitching(null)
    }
  }

  /** Create a new branch off HEAD (validated by git) and switch to it. Returns true on success. */
  const onCreate = async (name: string): Promise<boolean> => {
    const trimmed = name.trim()
    if (!sessionId || !trimmed || busy) return false
    if (list.some((b) => b.name === trimmed)) {
      feedback.show(`Branch "${trimmed}" already exists`, { tone: 'warning' })
      return false
    }
    setBusy(true)
    try {
      await createBranch(sessionId, trimmed)
      return true
    } catch (err) {
      gitFailed(`Could not create ${trimmed}`, err)
      return false
    } finally {
      setBusy(false)
    }
  }

  /** Rename a branch (not one held by another worktree). Returns true on success. */
  const onRename = async (from: string, to: string): Promise<boolean> => {
    const trimmed = to.trim()
    if (!sessionId || !trimmed || trimmed === from || busy) return false
    if (list.some((b) => b.name === trimmed)) {
      feedback.show(`Branch "${trimmed}" already exists`, { tone: 'warning' })
      return false
    }
    setBusy(true)
    try {
      await renameBranch(sessionId, from, trimmed)
      return true
    } catch (err) {
      gitFailed(`Could not rename ${from}`, err)
      return false
    } finally {
      setBusy(false)
    }
  }

  /**
   * Delete a local branch. Guards the current + worktree-occupied branches (git
   * refuses those anyway) with a plain toast. `git branch -d` refuses a branch
   * that isn't fully merged; that surfaces as `git_branch_not_merged`, in which
   * case we offer a "Delete anyway" row action that reruns with `-D` (force).
   *
   * That action expires with the row's callbacks (60 s), so it cannot force-delete a branch that
   * gained commits since. It is not behind a confirm dialog: the dialog would belong to this
   * list, and a row clicked after it closed would open nothing — the warning row, which names the
   * loss, is the confirmation.
   */
  const runDelete = async (name: string, force: boolean) => {
    if (!sessionId) return
    await runFor(name, async () => {
      try {
        await deleteBranch(sessionId, name, force)
      } catch (err) {
        if (!force && err instanceof MiniAppApiError && err.code === 'git_branch_not_merged') {
          toast.warning(`"${name}" isn't fully merged`, {
            description: 'Deleting it may lose commits that exist only on this branch.',
            action: { label: 'Delete anyway', onClick: () => void runDelete(name, true) },
          })
          return
        }
        gitFailed(`Could not delete ${name}`, err)
      }
    })
  }

  const onDelete = (name: string) => {
    const target = list.find((b) => b.name === name)
    if (name === currentBranch) {
      feedback.show(`"${name}" is the current branch`, {
        detail: 'Switch to another branch first, then delete it',
      })
      return
    }
    if (target?.worktreePath) {
      feedback.show(`"${name}" is open in another worktree`, {
        detail: 'Close or finish that conversation before deleting the branch',
      })
      return
    }
    void runDelete(name, false)
  }

  /**
   * Merge a branch INTO the current one. A merge that stops on conflicts is not
   * an error to dismiss — git leaves it in progress and the conflicted files are
   * already in the Changes tree — so it gets guidance and an Abort, not a red
   * toast.
   */
  const onMerge = (name: string, noFastForward = false) => {
    if (!sessionId) return
    if (name === currentBranch) {
      feedback.show(`"${name}" is already the current branch`)
      return
    }
    void runFor(name, async () => {
      try {
        await mergeBranchOp(sessionId, name, noFastForward)
        feedback.show(`Merged ${name} into ${currentBranch ?? 'HEAD'}`, { tone: 'success' })
      } catch (err) {
        if (err instanceof MiniAppApiError && err.code === 'git_merge_conflict') {
          toast.warning(`Merging ${name} stopped on conflicts`, {
            description: 'Resolve and stage them in Changes, then commit — or abort the merge.',
            action: {
              label: 'Abort merge',
              onClick: () => {
                void useSourceControlStore
                  .getState()
                  .abortMerge(sessionId)
                  .then(
                    () => toast.success('Merge aborted'),
                    (e: unknown) => gitFailed('Could not abort the merge', e),
                  )
              },
            },
          })
          return
        }
        gitFailed(`Could not merge ${name}`, err)
      }
    })
  }

  /**
   * Check out a remote branch (`origin/x`) by creating its local tracking branch.
   * Without this, a colleague's branch was reachable only from a terminal: the
   * list showed local branches, and nothing offered the one thing you do with a
   * remote one.
   */
  const onCheckoutRemote = (remoteRef: string) => {
    if (!sessionId) return
    void runFor(remoteRef, async () => {
      try {
        await checkoutRemote(sessionId, remoteRef)
      } catch (err) {
        gitFailed(`Could not check out ${remoteRef}`, err)
      }
    })
  }

  return {
    currentBranch,
    branches,
    list,
    remotes,
    switching,
    busy,
    /** True while THIS branch has an op in flight. */
    isPending: (name: string) => pending.has(name),
    onPick,
    onCreate,
    onRename,
    onDelete,
    onMerge,
    onCheckoutRemote,
  }
}
