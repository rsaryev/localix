/**
 * Writes that touch only the working tree and the index: staging (whole files or
 * selected lines), discarding, reverting one hunk, and appending to `.gitignore`.
 *
 * Grouped by what they invalidate rather than by subject. None of these can move
 * a ref, so each answers with the refreshed status ALONE — the store applies it,
 * patches the matching repo row, and repaints. Anything that CAN move a branch
 * tip lives in `ref-writes.ts` and answers with the branch list too.
 */
import { unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui'
import type { SourceControlMutation } from '../../backend/source-control/contracts'
import { client } from './client'

export const treeWrites = {
  async revertHunk(
    sessionId: string,
    path: string,
    index: number,
    header: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['revert-hunk'].$post({
        json: { sessionId, path, index, header, repoRoot },
      }),
    )
  },

  /** Stage exactly the selected diff lines of a file. */
  async stageLines(
    sessionId: string,
    path: string,
    lines: number[],
    diffId: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['stage-lines'].$post({
        json: { sessionId, path, lines, diffId, repoRoot },
      }),
    )
  },

  /** Unstage exactly the selected diff lines of a file. */
  async unstageLines(
    sessionId: string,
    path: string,
    lines: number[],
    diffId: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['unstage-lines'].$post({
        json: { sessionId, path, lines, diffId, repoRoot },
      }),
    )
  },

  /** Discard exactly the selected diff lines from the working tree (destructive). */
  async discardLines(
    sessionId: string,
    path: string,
    lines: number[],
    diffId: string,
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control']['discard-lines'].$post({
        json: { sessionId, path, lines, diffId, repoRoot },
      }),
    )
  },

  async stage(
    sessionId: string,
    paths: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].stage.$post({ json: { sessionId, paths, repoRoot } }),
    )
  },

  async unstage(
    sessionId: string,
    paths: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].unstage.$post({ json: { sessionId, paths, repoRoot } }),
    )
  },

  async discard(
    sessionId: string,
    paths: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].discard.$post({ json: { sessionId, paths, repoRoot } }),
    )
  },

  /** Append gitignore patterns (repo-root anchored lines) to the repo's `.gitignore`. */
  async addToGitignore(
    sessionId: string,
    patterns: string[],
    repoRoot?: string,
  ): Promise<SourceControlMutation> {
    return unwrapMiniAppResponse<SourceControlMutation>(
      await client.rpc['source-control'].gitignore.$post({
        json: { sessionId, patterns, repoRoot },
      }),
    )
  },
}
