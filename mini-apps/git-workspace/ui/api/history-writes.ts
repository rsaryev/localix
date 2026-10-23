/**
 * Writes that create or rewrite HISTORY: commit and amend, the commit-level
 * operations (revert, cherry-pick, reset, detached checkout), the whole
 * interactive-rebase family, bisect, and the working-tree nuke.
 *
 * All of them move HEAD, so all of them answer with the branch list as well as
 * the status — and the store bumps `logVersion` for them (`bumpsLog` in
 * `model/git-store/mutations.ts`, pinned by its test), which is what tells the
 * commit graph (which fetches its own log) that its data is stale.
 */
import { unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui'
import type {
  BisectTerm,
  RebaseTodoEntry,
  ResetMode,
  SourceControlMutation,
} from '../../backend/source-control/contracts'
import { client } from './client'

export const historyWrites = {
  async commit(
    sessionId: string,
    message: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].commit.$post({ json: { sessionId, message, repoRoot } }),
    )
  },

  async amend(
    sessionId: string,
    message: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].amend.$post({ json: { sessionId, message, repoRoot } }),
    )
  },

  // --- Recovery / danger operations -------------------------------------------

  /** Discard ALL uncommitted changes (optionally untracked too). Destructive. */
  async nuke(
    sessionId: string,
    removeUntracked: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].nuke.$post({
        json: { sessionId, removeUntracked, repoRoot },
      }),
    )
  },

  // --- Commit-level operations (by hash) --------------------------------------

  /** Create a NEW commit undoing `hash` (history-preserving); throws git_revert_conflict on conflict. */
  async revertCommit(
    sessionId: string,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].revert.$post({ json: { sessionId, hash, repoRoot } }),
    )
  },

  /** Replay `hash` onto the current branch; throws git_cherry_pick_conflict on conflict. */
  async cherryPick(
    sessionId: string,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['cherry-pick'].$post({
        json: { sessionId, hash, repoRoot },
      }),
    )
  },

  /** Move the current branch to `hash` at `mode` (`hard` is destructive). */
  async resetToCommit(
    sessionId: string,
    hash: string,
    mode: ResetMode,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].reset.$post({ json: { sessionId, hash, mode, repoRoot } }),
    )
  },

  /** Check out `hash` directly, detaching HEAD (no branch current afterwards). */
  async checkoutCommit(
    sessionId: string,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['checkout-commit'].$post({
        json: { sessionId, hash, repoRoot },
      }),
    )
  },

  // --- Interactive rebase (history rewrite) -----------------------------------

  /** Apply a composed interactive rebase over `fromHash..HEAD`; throws git_rebase_conflict/dirty/range on failure. */
  async interactiveRebase(
    sessionId: string,
    fromHash: string,
    entries: RebaseTodoEntry[],
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].rebase.$post({
        json: { sessionId, fromHash, entries, repoRoot },
      }),
    )
  },

  /** Change a commit's message (amend when HEAD, else a one-commit reword rebase). */
  async rewordCommit(
    sessionId: string,
    hash: string,
    message: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].reword.$post({
        json: { sessionId, hash, message, repoRoot },
      }),
    )
  },

  /** Fold the currently-staged changes into an older commit (`--fixup` + autosquash). */
  async fixupInto(
    sessionId: string,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['fixup-into'].$post({
        json: { sessionId, hash, repoRoot },
      }),
    )
  },

  /** Rebase the current branch onto `base` (a commit sha or branch name). */
  async rebaseOnto(
    sessionId: string,
    base: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['rebase-onto'].$post({
        json: { sessionId, base, repoRoot },
      }),
    )
  },

  /** Continue an in-progress rebase after conflicts were resolved + staged. */
  async rebaseContinue(sessionId: string, repoRoot?: string): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['rebase-continue'].$post({
        json: { sessionId, repoRoot },
      }),
    )
  },

  /** Abort an in-progress rebase, restoring the pre-rebase state. */
  async rebaseAbort(sessionId: string, repoRoot?: string): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['rebase-abort'].$post({ json: { sessionId, repoRoot } }),
    )
  },

  /** Skip the current patch of an in-progress rebase. */
  async rebaseSkip(sessionId: string, repoRoot?: string): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['rebase-skip'].$post({ json: { sessionId, repoRoot } }),
    )
  },

  // --- Bisect (regression search) ---------------------------------------------

  /** Start a bisect marking `hash` bad (regression present) and optionally `good` (works). */
  async bisectStart(
    sessionId: string,
    hash: string,
    good?: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].bisect.start.$post({
        json: { sessionId, hash, good, repoRoot },
      }),
    )
  },

  /** Mark the current commit good/bad/skip and advance the search. */
  async bisectMark(
    sessionId: string,
    term: BisectTerm,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].bisect.mark.$post({ json: { sessionId, term, repoRoot } }),
    )
  },

  /** End the bisect and return to the original branch/HEAD. */
  async bisectReset(sessionId: string, repoRoot?: string): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].bisect.reset.$post({ json: { sessionId, repoRoot } }),
    )
  },
}
