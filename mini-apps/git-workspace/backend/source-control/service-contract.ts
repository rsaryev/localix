/**
 * What the source-control service PROMISES — the port every route calls and
 * every UI method mirrors.
 *
 * Split out of `service.ts`, which had grown past the repo's size ratchet: this
 * is a contract, not an implementation, and ~370 lines of signatures sitting on
 * top of the ~200 that do the work meant reading either required scrolling past
 * the other. `service.ts` re-exports this, so no importer had to change.
 *
 * The writes are split again, along the seam the implementation already draws:
 * a WORKING-TREE write answers with the status alone, while a write that moves a
 * ref, rewrites history or talks to a remote also answers with the branch list
 * (see `SourceControlMutation`). Which file a method lives in tells you which.
 */
import type {
  BlameLine,
  CommitCompletionContext,
  CommitNote,
  FileDiff,
  FileDiffInput,
  FileDiffLines,
  LineStageMode,
  LogFilter,
  RangeDiff,
  RepoCommit,
  RepoFileHunk,
  RepoStash,
  RepoWithStatus,
  SourceControlBranches,
  SourceControlStatus,
  SourceControlWorkspace,
} from './contracts'
import type { SourceControlRefWrites } from './service-ref-writes'
import type { SourceControlTreeWrites } from './service-tree-writes'

/** Everything that only OBSERVES the repository. */
export interface SourceControlReads {
  /** Every repository discovered for the session (multi-root), each with status; single entry for a normal project. */
  listRepos(userId: string, sessionId: string | null): Promise<RepoWithStatus[]>
  /**
   * Repos + the focused repo's status, branches and stashes in ONE call. This is
   * what the panel polls; `repoRoot` is the caller's current focus (honoured when
   * it still exists, otherwise the primary repo wins and `activeRepo` says so).
   */
  getWorkspace(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlWorkspace>
  getStatus(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlStatus>
  getBranches(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<SourceControlBranches>
  getLog(
    userId: string,
    sessionId: string | null,
    limit?: number,
    filter?: LogFilter,
    repoRoot?: string,
  ): Promise<RepoCommit[]>
  /** The diff between two commits (`from` base, `to` target); throws a typed error on a bad/unresolvable ref. */
  getRangeDiff(
    userId: string,
    sessionId: string | null,
    from: string,
    to: string,
    threeDot?: boolean,
    repoRoot?: string,
  ): Promise<RangeDiff>
  getFileDiff(
    userId: string,
    sessionId: string | null,
    input: FileDiffInput,
    repoRoot?: string,
  ): Promise<FileDiff>
  getWorkingDiff(userId: string, sessionId: string | null, repoRoot?: string): Promise<FileDiff>
  /** Granular change hunks of a file vs the committed tree (for inline peek + revert). */
  getFileHunks(
    userId: string,
    sessionId: string | null,
    path: string,
    repoRoot?: string,
  ): Promise<RepoFileHunk[]>
  /** A file's diff as selectable lines, for line-level staging. */
  getFileDiffLines(
    userId: string,
    sessionId: string | null,
    input: { path: string; mode: LineStageMode },
    repoRoot?: string,
  ): Promise<FileDiffLines>
  /** Per-line authorship of a file (optional 1-based range), for inline blame; empty when not a repo. */
  getBlame(
    userId: string,
    sessionId: string | null,
    file: string,
    range?: { start: number; end: number },
    repoRoot?: string,
  ): Promise<BlameLine[]>
  /** Full patch of a single commit by hash, as a unified-diff string. */
  getCommitShow(
    userId: string,
    sessionId: string | null,
    hash: string,
    repoRoot?: string,
  ): Promise<FileDiff>
  /** Provenance note of a single commit by hash, or null when none. */
  getCommitNote(
    userId: string,
    sessionId: string | null,
    hash: string,
    repoRoot?: string,
  ): Promise<CommitNote | null>
  /** Full message of the current HEAD commit (for prefilling an amend), or null when none. */
  getHeadCommitMessage(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<string | null>
  /** Recent commit messages (newest first) for composer ↑/↓ recall; empty when not a repo. */
  getRecentCommitMessages(
    userId: string,
    sessionId: string | null,
    limit?: number,
    repoRoot?: string,
  ): Promise<string[]>
  /** Read-only, bounded upstream by the consumer; null when there is no change to describe. */
  getCommitCompletionContext(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
    signal?: AbortSignal,
  ): Promise<CommitCompletionContext | null>
  /** The saved stash stack (newest first); empty when not a repo. */
  getStashes(userId: string, sessionId: string | null, repoRoot?: string): Promise<RepoStash[]>
  /** The full patch of a stash entry (for opening a stash diff). */
  getStashDiff(
    userId: string,
    sessionId: string | null,
    index: number,
    repoRoot?: string,
  ): Promise<FileDiff>
}

export interface SourceControlService
  extends SourceControlReads, SourceControlTreeWrites, SourceControlRefWrites {}
