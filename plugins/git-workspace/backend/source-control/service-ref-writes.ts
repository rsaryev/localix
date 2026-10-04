/**
 * Writes that move a ref, rewrite history, or talk to a remote — checkout,
 * commit, rebase, bisect, stash, push/pull/fetch.
 *
 * Grouped by what they invalidate: every one of these can change branch identity
 * or ahead/behind, so each answers with the branch list alongside the refreshed
 * status (see `SourceControlMutation`) and the UI repaints from that answer
 * without a follow-up read. Working-tree-only writes live next door in
 * `service-tree-writes.ts` and answer with less.
 */
import type { BisectTerm, RebaseTodoEntry, ResetMode, SourceControlMutation } from './contracts'

export interface SourceControlRefWrites {
  /** Create a NEW commit undoing `hash`; returns the refreshed status (throws a typed conflict error). */
  revertCommit(
    userId: string,
    sessionId: string | null,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Replay `hash` onto the current branch; returns the refreshed status (throws a typed conflict error). */
  cherryPick(
    userId: string,
    sessionId: string | null,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Move the current branch to `hash` at `mode` (hard is destructive); returns the refreshed status. */
  resetToCommit(
    userId: string,
    sessionId: string | null,
    hash: string,
    mode: ResetMode,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Check out `hash` directly (detached HEAD); returns the refreshed status (`detached` now true). */
  checkoutCommit(
    userId: string,
    sessionId: string | null,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Create a new branch `name` at `hash` without switching; returns the refreshed status. */
  createBranchAt(
    userId: string,
    sessionId: string | null,
    name: string,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  switchBranch(
    userId: string,
    sessionId: string | null,
    branch: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Create + switch to the local tracking branch for a remote-tracking ref (`origin/x`). */
  checkoutRemoteBranch(
    userId: string,
    sessionId: string | null,
    remoteRef: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Merge `branch` into the current one; throws `git_merge_conflict` when it stops on conflicts. */
  mergeBranch(
    userId: string,
    sessionId: string | null,
    branch: string,
    noFastForward: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Abandon an in-progress merge. */
  abortMerge(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Create a new branch off HEAD and switch to it; returns the refreshed status. */
  createBranch(
    userId: string,
    sessionId: string | null,
    name: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Rename branch `from` to `to`; returns the refreshed status. */
  renameBranch(
    userId: string,
    sessionId: string | null,
    from: string,
    to: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Delete a local branch (`force` uses `-D`); returns the refreshed status. */
  deleteBranch(
    userId: string,
    sessionId: string | null,
    name: string,
    force: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  commit(
    userId: string,
    sessionId: string | null,
    message: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Rewrite the last commit with `message`, folding in staged changes. */
  amend(
    userId: string,
    sessionId: string | null,
    message: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Discard ALL uncommitted changes (optionally untracked too); returns the refreshed status. */
  nuke(
    userId: string,
    sessionId: string | null,
    removeUntracked: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Apply a composed interactive rebase over `fromHash..HEAD`; returns the refreshed status (throws typed conflict/range errors). */
  interactiveRebase(
    userId: string,
    sessionId: string | null,
    fromHash: string,
    entries: RebaseTodoEntry[],
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Change a commit's message; returns the refreshed status (throws a typed error). */
  rewordCommit(
    userId: string,
    sessionId: string | null,
    hash: string,
    message: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Fold the staged changes into an older commit; returns the refreshed status (throws typed errors). */
  fixupInto(
    userId: string,
    sessionId: string | null,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Rebase the current branch onto `base`; returns the refreshed status (throws typed conflict error). */
  rebaseOnto(
    userId: string,
    sessionId: string | null,
    base: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Continue an in-progress rebase; returns the refreshed status (throws git_rebase_conflict if it stops again). */
  rebaseContinue(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Abort an in-progress rebase; returns the refreshed status. */
  rebaseAbort(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Skip the current patch of an in-progress rebase; returns the refreshed status. */
  rebaseSkip(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Start a bisect marking `bad` (+ optional `good`); returns the refreshed status (bisect state on `.bisect`). */
  bisectStart(
    userId: string,
    sessionId: string | null,
    bad: string,
    good?: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Mark the current commit good/bad/skip and advance; returns the refreshed status. */
  bisectMark(
    userId: string,
    sessionId: string | null,
    term: BisectTerm,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** End the bisect and return to the original branch/HEAD; returns the refreshed status. */
  bisectReset(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  push(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
    force?: boolean,
  ): Promise<SourceControlMutation>
  pull(userId: string, sessionId: string | null, repoRoot?: string): Promise<SourceControlMutation>
  /** Refresh remote-tracking refs (fetch) and return the re-read status so behind/ahead update. */
  fetch(userId: string, sessionId: string | null, repoRoot?: string): Promise<SourceControlMutation>
  /** Save the working tree to a new stash; returns the refreshed status. */
  createStash(
    userId: string,
    sessionId: string | null,
    input: { message?: string; includeUntracked: boolean },
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Restore a stash by index (`pop` removes it, otherwise apply keeps it); returns the refreshed status. */
  applyStash(
    userId: string,
    sessionId: string | null,
    index: number,
    pop: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
  /** Drop a stash by index; returns the refreshed status. */
  dropStash(
    userId: string,
    sessionId: string | null,
    index: number,
    repoRoot?: string,
  ): Promise<SourceControlMutation>
}
