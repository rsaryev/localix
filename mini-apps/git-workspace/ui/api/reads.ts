/**
 * Every source-control READ the panel makes: the workspace snapshot it polls,
 * plus the diffs, hunks, blame, history and stash patches it fetches on demand.
 *
 * `getWorkspace` is the one that matters for latency — it replaced four separate
 * polled endpoints (`/repos`, `/status`, `/branches`, `/stashes`), and the second
 * full `git status` of the focused repo that the `/repos` + `/status` pair used
 * to compute from two different snapshots of one tree. The four per-part readers
 * had no caller left and are gone, so nothing can drift back to them.
 */
import { cleanMiniAppQuery, unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui'
import type {
  BlameLine,
  CommitNote,
  FileDiff,
  FileDiffLines,
  LineStageMode,
  LogFilter,
  RangeDiff,
  RepoCommit,
  RepoFileHunk,
  SourceControlWorkspace,
  SourceControlWorkspaceWire,
} from '../../backend/source-control/contracts'
import { fromWorkspaceWire } from '../../backend/source-control/workspace-wire'
import { client } from './client'

export const sourceControlReads = {
  /**
   * The whole panel's state in ONE request: repo inventory + the focused repo's
   * status, branches and stashes. `repoRoot` is the caller's current focus; the
   * response says which repo it actually described (`activeRepo`).
   */
  async getWorkspace(sessionId: string, repoRoot?: string): Promise<SourceControlWorkspace> {
    const wire = await unwrapMiniAppResponse<SourceControlWorkspaceWire>(
      await client.rpc['source-control'].workspace.$get({
        query: cleanMiniAppQuery({ sessionId, repoRoot }),
      }),
    )
    return fromWorkspaceWire(wire)
  },

  async getLog(
    sessionId: string,
    limit?: number,
    filter?: LogFilter,
    repoRoot?: string,
  ): Promise<RepoCommit[]> {
    const json = await unwrapMiniAppResponse<{ commits: RepoCommit[] }>(
      await client.rpc['source-control'].log.$get({
        query: cleanMiniAppQuery({
          sessionId,
          limit,
          query: filter?.query,
          author: filter?.author,
          path: filter?.path,
          repoRoot,
        }),
      }),
    )
    return json.commits
  },

  /** Diff between two commits (`from` base, `to` target); `threeDot` picks the symmetric range. */
  async getRangeDiff(
    sessionId: string,
    from: string,
    to: string,
    threeDot?: boolean,
    repoRoot?: string,
  ): Promise<RangeDiff> {
    return unwrapMiniAppResponse<RangeDiff>(
      // `from`/`to` are required by the route schema, so build the query as a typed literal.
      await client.rpc['source-control']['range-diff'].$get({
        query: {
          sessionId,
          from,
          to,
          ...(threeDot ? { threeDot: '1' as const } : {}),
          ...(repoRoot ? { repoRoot } : {}),
        },
      }),
    )
  },

  async getFileDiff(
    sessionId: string,
    path: string,
    opts?: { staged?: boolean; untracked?: boolean },
    repoRoot?: string,
  ): Promise<FileDiff> {
    return unwrapMiniAppResponse<FileDiff>(
      await client.rpc['source-control'].diff.$get({
        // `path` is required by the route schema, so build the query as a typed
        // literal (cleanQuery widens to Record<string,string> and loses it).
        query: {
          sessionId,
          path,
          ...(opts?.staged ? { staged: '1' as const } : {}),
          ...(opts?.untracked ? { untracked: '1' as const } : {}),
          ...(repoRoot ? { repoRoot } : {}),
        },
      }),
    )
  },

  async getWorkingDiff(sessionId: string, repoRoot?: string): Promise<FileDiff> {
    return unwrapMiniAppResponse<FileDiff>(
      await client.rpc['source-control']['working-diff'].$get({
        query: cleanMiniAppQuery({ sessionId, repoRoot }),
      }),
    )
  },

  async getFileHunks(sessionId: string, path: string, repoRoot?: string): Promise<RepoFileHunk[]> {
    const json = await unwrapMiniAppResponse<{ path: string; hunks: RepoFileHunk[] }>(
      // `path` is required by the route schema, so build the query as a typed literal.
      await client.rpc['source-control'].hunks.$get({
        query: { sessionId, path, ...(repoRoot ? { repoRoot } : {}) },
      }),
    )
    return json.hunks
  },

  /** A file's diff as selectable lines, for line-level staging (`unstaged`/`staged` view). */
  async getFileDiffLines(
    sessionId: string,
    path: string,
    mode: LineStageMode,
    repoRoot?: string,
  ): Promise<FileDiffLines> {
    return unwrapMiniAppResponse<FileDiffLines>(
      // `path` is required by the route schema, so build the query as a typed literal.
      await client.rpc['source-control']['diff-lines'].$get({
        query: { sessionId, path, mode, ...(repoRoot ? { repoRoot } : {}) },
      }),
    )
  },

  /** Per-line authorship of a file (for the editor's inline blame decoration); empty when not a repo. */
  async getBlame(sessionId: string, path: string, repoRoot?: string): Promise<BlameLine[]> {
    const json = await unwrapMiniAppResponse<{ lines: BlameLine[] }>(
      // `path` is required by the route schema, so build the query as a typed literal.
      await client.rpc['source-control'].blame.$get({
        query: { sessionId, path, ...(repoRoot ? { repoRoot } : {}) },
      }),
    )
    return json.lines
  },

  async getCommitDiff(sessionId: string, hash: string, repoRoot?: string): Promise<FileDiff> {
    return unwrapMiniAppResponse<FileDiff>(
      // `hash` is required by the route schema, so build the query as a typed
      // literal (cleanQuery widens to Record<string,string> and loses it).
      await client.rpc['source-control']['commit-diff'].$get({
        query: { sessionId, hash, ...(repoRoot ? { repoRoot } : {}) },
      }),
    )
  },

  async getCommitNote(
    sessionId: string,
    hash: string,
    repoRoot?: string,
  ): Promise<CommitNote | null> {
    const json = await unwrapMiniAppResponse<{ note: CommitNote | null }>(
      // `hash` is required by the route schema, so build the query as a typed literal.
      await client.rpc['source-control']['commit-note'].$get({
        query: { sessionId, hash, ...(repoRoot ? { repoRoot } : {}) },
      }),
    )
    return json.note
  },

  /** Full message of the current HEAD commit (for prefilling an amend), or null when none. */
  async getHeadCommitMessage(sessionId: string, repoRoot?: string): Promise<string | null> {
    const json = await unwrapMiniAppResponse<{ message: string | null }>(
      await client.rpc['source-control']['head-commit'].$get({
        query: cleanMiniAppQuery({ sessionId, repoRoot }),
      }),
    )
    return json.message
  },

  /** Recent commit messages (newest first) for composer ↑/↓ recall. */
  async getRecentCommitMessages(
    sessionId: string,
    limit?: number,
    repoRoot?: string,
  ): Promise<string[]> {
    const json = await unwrapMiniAppResponse<{ messages: string[] }>(
      await client.rpc['source-control']['recent-messages'].$get({
        query: cleanMiniAppQuery({ sessionId, limit, repoRoot }),
      }),
    )
    return json.messages
  },

  /** The full patch of a stash entry (for opening a stash diff). */
  async getStashDiff(sessionId: string, index: number, repoRoot?: string): Promise<FileDiff> {
    return unwrapMiniAppResponse<FileDiff>(
      // `index` is required by the route schema (coerced to a number), so build a
      // typed query literal — cleanQuery would widen and drop it.
      await client.rpc['source-control']['stash-diff'].$get({
        query: { sessionId, index: String(index), ...(repoRoot ? { repoRoot } : {}) },
      }),
    )
  },
}
