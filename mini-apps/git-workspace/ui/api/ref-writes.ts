/**
 * Writes that move a ref or talk to a remote: branch create/rename/delete/switch,
 * checking out a remote branch, merging, the stash stack, and push/pull/fetch.
 *
 * Each answers with the branch list alongside the refreshed status, because each
 * can change branch identity or ahead/behind. That is the whole reason the panel
 * no longer re-reads the workspace after a click: deleting a branch used to mean
 * a write plus a full four-endpoint refresh queued behind the current poll.
 */
import { unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui'
import type { SourceControlMutation } from '../../backend/source-control/contracts'
import { client } from './client'

export const refWrites = {
  async switchBranch(
    sessionId: string,
    branch: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].switch.$post({ json: { sessionId, branch, repoRoot } }),
    )
  },

  /** Check out a remote branch (`origin/x`) by creating its local tracking branch. */
  async checkoutRemoteBranch(
    sessionId: string,
    remoteRef: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['checkout-remote'].$post({
        json: { sessionId, remoteRef, repoRoot },
      }),
    )
  },

  /** Merge `branch` into the current one; throws `git_merge_conflict` when it stops. */
  async mergeBranch(
    sessionId: string,
    branch: string,
    noFastForward?: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].merge.$post({
        json: { sessionId, branch, noFastForward, repoRoot },
      }),
    )
  },

  /** Abandon an in-progress merge. */
  async abortMerge(sessionId: string, repoRoot?: string): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['merge-abort'].$post({ json: { sessionId, repoRoot } }),
    )
  },

  /** Create a new branch off HEAD and switch to it; git validates the name. */
  async createBranch(
    sessionId: string,
    name: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['create-branch'].$post({
        json: { sessionId, name, repoRoot },
      }),
    )
  },

  /** Rename branch `from` to `to`. */
  async renameBranch(
    sessionId: string,
    from: string,
    to: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['rename-branch'].$post({
        json: { sessionId, from, to, repoRoot },
      }),
    )
  },

  /** Delete a local branch. `force` (`-D`) drops an unmerged branch; git refuses the current/occupied one. */
  async deleteBranch(
    sessionId: string,
    name: string,
    force: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['delete-branch'].$post({
        json: { sessionId, name, force, repoRoot },
      }),
    )
  },

  /** Push the current branch; `force` retries a rejected push with `--force-with-lease`. */
  async push(
    sessionId: string,
    repoRoot?: string,
    force?: boolean,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].push.$post({ json: { sessionId, repoRoot, force } }),
    )
  },

  async pull(sessionId: string, repoRoot?: string): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].pull.$post({ json: { sessionId, repoRoot } }),
    )
  },

  /** Refresh remote-tracking refs (git fetch) so behind/ahead reflect the remote. */
  async fetch(sessionId: string, repoRoot?: string): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].fetch.$post({ json: { sessionId, repoRoot } }),
    )
  },

  /** Save the working tree to a new stash (untracked files included by default). */
  async createStash(
    sessionId: string,
    opts?: { message?: string; includeUntracked?: boolean },
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].stash.$post({
        json: {
          sessionId,
          message: opts?.message,
          includeUntracked: opts?.includeUntracked,
          repoRoot,
        },
      }),
    )
  },

  /** Restore a stash by index. `pop` removes it on success; otherwise it's kept (apply). */
  async applyStash(
    sessionId: string,
    index: number,
    pop: boolean,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['stash-apply'].$post({
        json: { sessionId, index, pop, repoRoot },
      }),
    )
  },

  /** Drop a stash by index (destructive). */
  async dropStash(
    sessionId: string,
    index: number,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['stash-drop'].$post({
        json: { sessionId, index, repoRoot },
      }),
    )
  },

  /** Create a new branch `name` at `hash` without switching to it. */
  async createBranchAt(
    sessionId: string,
    name: string,
    hash: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['branch-at'].$post({
        json: { sessionId, name, hash, repoRoot },
      }),
    )
  },
}
