/**
 * The source-control seam. A `SourceControlBackend` is one VCS implementation
 * (git today); the service depends on this port, never on git directly. A
 * resolver picks the backend that owns a given working directory — today that's
 * a one-entry registry, but new backends (jj, hg, …) drop in by appending to
 * the list, mirroring the mini app/provider drop-in model. New operations
 * (stage, commit, push, …) extend this interface and every backend implements
 * them; the service and routes grow additively.
 */
import type {
  BisectState,
  BisectTerm,
  BlameLine,
  CommitNote,
  FileDiff,
  FileDiffInput,
  FileDiffLines,
  LineStageMode,
  LogFilter,
  RangeDiff,
  RebaseTodoEntry,
  RepoBranch,
  RepoCommit,
  RepoRemoteBranch,
  RepoFileHunk,
  RepoStash,
  RepoStatus,
  ResetMode,
} from './contracts'

/** A line-level staging op: a file, the raw-diff line indices, and the drift-guard fingerprint. */
export interface LineStageInput {
  path: string
  lines: number[]
  diffId: string
}

export interface SourceControlBackend {
  /** Stable id surfaced to clients (e.g. `git`). */
  readonly id: string
  /** True when this backend owns the repository rooted at/above `cwd`. */
  detect(cwd: string): Promise<boolean>
  getStatus(cwd: string, signal?: AbortSignal): Promise<RepoStatus>
  listBranches(cwd: string): Promise<RepoBranch[]>
  /**
   * Every remote-tracking branch. Which of them have no LOCAL counterpart is the
   * service's join to make — asking for the local set here would force this call
   * to wait on `listBranches` instead of running beside it.
   */
  listRemoteBranches(cwd: string): Promise<RepoRemoteBranch[]>
  /** Create + switch to the local tracking branch for a remote-tracking ref. */
  checkoutRemoteBranch(cwd: string, remoteRef: string): Promise<void>
  /** Merge `branch` into the current one; throws a typed conflict error when it stops. */
  mergeBranch(cwd: string, branch: string, opts: { noFastForward?: boolean }): Promise<void>
  /** Abandon an in-progress merge. */
  abortMerge(cwd: string): Promise<void>
  /** Recent commits on the current branch, newest first. Optional `filter` narrows by message/author/path. */
  getLog(cwd: string, limit: number, filter?: LogFilter): Promise<RepoCommit[]>
  /** The diff between two commits (`from` base, `to` target); `threeDot` picks the symmetric range. */
  getRangeDiff(cwd: string, from: string, to: string, threeDot?: boolean): Promise<RangeDiff>
  getFileDiff(cwd: string, input: FileDiffInput): Promise<FileDiff>
  /** The full working-tree diff (tracked changes + untracked files) as one pure unified-diff string. */
  getWorkingDiff(cwd: string): Promise<FileDiff>
  /** Granular change hunks of a file vs the committed tree (for inline peek + revert). */
  getFileHunks(cwd: string, path: string): Promise<RepoFileHunk[]>
  /** Revert a single hunk of a file back to its committed state (destructive, one change). */
  revertHunk(cwd: string, input: { path: string; index: number; header: string }): Promise<void>
  /** A file's diff as selectable lines, for line-level staging (`staged`/`unstaged` view). */
  getFileDiffLines(
    cwd: string,
    input: { path: string; mode: LineStageMode },
  ): Promise<FileDiffLines>
  /** Stage exactly the selected diff lines of a file (`git apply --cached` of a partial patch). */
  stageLines(cwd: string, input: LineStageInput): Promise<void>
  /** Unstage exactly the selected diff lines of a file (reverse-apply to the index). */
  unstageLines(cwd: string, input: LineStageInput): Promise<void>
  /** Discard exactly the selected diff lines from the working tree (destructive). */
  discardLines(cwd: string, input: LineStageInput): Promise<void>
  /**
   * Per-line authorship of a file (optionally a 1-based `[start,end]` line range),
   * for the editor's inline blame decoration. Read-only; never throws — a failure
   * (not tracked, unborn branch) yields an empty list.
   */
  blame(cwd: string, file: string, range?: { start: number; end: number }): Promise<BlameLine[]>
  /** Full patch of a single commit by hash/ref, as a pure unified-diff string. */
  getCommitShow(cwd: string, hash: string): Promise<FileDiff>
  /** Repo-relative paths a commit touched (for drilling a commit into its files). */
  getCommitFiles(cwd: string, hash: string): Promise<string[]>
  /** Single-file patch of one path within a commit, as a pure unified-diff string. */
  getCommitFileDiff(cwd: string, hash: string, path: string): Promise<string>
  /** Create a NEW commit undoing `hash` (`revert --no-edit`); typed conflict error leaves markers to resolve. */
  revertCommit(cwd: string, hash: string): Promise<void>
  /** Replay `hash` onto the current branch (`cherry-pick`); typed conflict error leaves markers to resolve. */
  cherryPick(cwd: string, hash: string): Promise<void>
  /** Move the current branch to `hash` at `mode` (`reset --soft|--mixed|--hard`; hard is destructive). */
  resetToCommit(cwd: string, hash: string, mode: ResetMode): Promise<void>
  /** Check out `hash` directly, detaching HEAD (no branch current afterwards). */
  checkoutCommit(cwd: string, hash: string): Promise<void>
  /** Create a new branch `name` pointing at `hash`, WITHOUT switching to it (HEAD unchanged). */
  createBranchAt(cwd: string, name: string, hash: string): Promise<void>
  switchBranch(cwd: string, branch: string): Promise<void>
  /** Create a new branch off the current HEAD and switch to it. */
  createBranch(cwd: string, name: string): Promise<void>
  /** Rename branch `from` to `to` (works whether or not `from` is current). */
  renameBranch(cwd: string, from: string, to: string): Promise<void>
  /** Delete a local branch. `force` uses `-D` (drops an unmerged branch); the VCS refuses the current/occupied branch. */
  deleteBranch(cwd: string, name: string, force: boolean): Promise<void>
  /** Stage paths (files or directories) for the next commit. */
  stage(cwd: string, paths: string[]): Promise<void>
  /** Remove paths from the staging area (index back to HEAD; working tree kept). */
  unstage(cwd: string, paths: string[]): Promise<void>
  /** Discard unstaged changes — restore worktree from index, delete untracked; preserve staged. */
  discard(cwd: string, paths: string[]): Promise<void>
  /** Append gitignore patterns (repo-root anchored lines) to the repo's `.gitignore`, idempotently. */
  addToGitignore(cwd: string, patterns: string[]): Promise<void>
  /** Commit the staged changes with `message`. */
  commit(cwd: string, message: string): Promise<void>
  /** Rewrite the last commit with `message`, folding in staged changes (destructive to history). */
  amend(cwd: string, message: string): Promise<void>
  /** Full message of the current HEAD commit (for prefilling an amend), or null on an unborn branch. */
  getHeadCommitMessage(cwd: string): Promise<string | null>
  /** Recent commit messages (full body, newest first) for composer ↑/↓ recall. */
  getRecentCommitMessages(cwd: string, limit: number, signal?: AbortSignal): Promise<string[]>
  /** The saved stash stack (newest first); empty when none. */
  listStashes(cwd: string): Promise<RepoStash[]>
  /** Save the working tree to a new stash. `includeUntracked` adds untracked files (`-u`). */
  createStash(cwd: string, input: { message?: string; includeUntracked: boolean }): Promise<void>
  /** Restore a stash by index — `pop` removes it on success, otherwise it's kept (apply). */
  applyStash(cwd: string, index: number, pop: boolean): Promise<void>
  /** Discard a stash entry by index (destructive). */
  dropStash(cwd: string, index: number): Promise<void>
  /** The full patch of a stash entry (`git stash show -p`) as a FileDiff. */
  showStash(cwd: string, index: number): Promise<FileDiff>
  /** Discard ALL uncommitted changes (`reset --hard HEAD` + optional `clean -fd`). Destructive. */
  nukeWorkingTree(cwd: string, opts: { removeUntracked: boolean }): Promise<void>
  /**
   * Apply a composed interactive rebase over `fromHash..HEAD` — the todo `entries`
   * (pick/reword/squash/fixup/drop, reordered) run through a scripted, NON-interactive
   * sequence editor. Refuses on a dirty tree; a conflict leaves the rebase in progress.
   */
  interactiveRebase(cwd: string, fromHash: string, entries: RebaseTodoEntry[]): Promise<void>
  /** Change a commit's message (amend when it's HEAD, else a one-commit reword rebase). */
  rewordCommit(cwd: string, hash: string, message: string): Promise<void>
  /** Fold the currently-staged changes into an older commit (`--fixup` + autosquash rebase). */
  fixupInto(cwd: string, hash: string): Promise<void>
  /** Rebase the current branch onto `base` (a commit or branch). Refuses on a dirty tree. */
  rebaseOnto(cwd: string, base: string): Promise<void>
  /** Continue an in-progress rebase after conflicts were resolved + staged. */
  rebaseContinue(cwd: string): Promise<void>
  /** Abort an in-progress rebase, restoring the pre-rebase state. */
  rebaseAbort(cwd: string): Promise<void>
  /** Skip the current patch of an in-progress rebase. */
  rebaseSkip(cwd: string): Promise<void>
  /** Start a bisect marking `bad` (regression present) and optionally `good` (works); checks out the midpoint. */
  bisectStart(cwd: string, bad: string, good?: string): Promise<BisectState>
  /** Mark the current commit good/bad/skip and advance the search; returns the updated state (next commit or the culprit). */
  bisectMark(cwd: string, term: BisectTerm): Promise<BisectState>
  /** End the bisect and return to the original branch/HEAD. */
  bisectReset(cwd: string): Promise<void>
  /** Push the current branch to its remote (creating the upstream if needed). */
  push(cwd: string, opts?: { force?: boolean }): Promise<void>
  /** Fast-forward the current branch to its upstream (`pull --ff-only`); refuses on divergence. */
  pull(cwd: string): Promise<void>
  /** Refresh remote-tracking refs without integrating (`fetch --prune`) so ahead/behind reflect the remote. */
  fetch(cwd: string): Promise<void>
  /** The change set a commit message should summarize: bounded diff evidence + tracked `--stat` (staged if any). */
  getCommitDiff(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ diff: string; stat: string; staged: boolean }>
  /**
   * Commit provenance via git notes (best-effort, no side DB — git is the source
   * of truth). `writeCommitNote` is called by the service right after a commit.
   */
  writeCommitNote(cwd: string, sha: string, note: CommitNote): Promise<void>
  /** Resolve `HEAD` to a full commit sha (used to note the just-made commit); null when none. */
  resolveHead(cwd: string): Promise<string | null>
  /** Read a commit's provenance note, or null when none. */
  readCommitNote(cwd: string, sha: string): Promise<CommitNote | null>
  /** Full commit shas that carry a provenance note — one call to badge the log. */
  listNotedCommits(cwd: string): Promise<Set<string>>
}

/** Resolves the owning backend for a directory, or null when none claims it. */
export type ResolveBackend = (cwd: string) => Promise<SourceControlBackend | null>

/**
 * Resolves the working directory a source-control op runs in; null when none can
 * be determined. `repoRoot` targets a specific repository in a multi-root project
 * (a container of several git repos) — when omitted, or not a known repo of the
 * session, the session's primary/base repo is used.
 */
export type ResolveCwd = (
  userId: string,
  sessionId: string | null,
  repoRoot?: string,
) => Promise<string | null>

/**
 * First-match registry over `backends`. Order is precedence — list the most
 * specific/likely backend first. A backend whose `detect` throws is skipped so
 * one misbehaving probe can't block the rest.
 */
export function createBackendResolver(backends: SourceControlBackend[]): ResolveBackend {
  return async (cwd) => {
    for (const backend of backends) {
      try {
        if (await backend.detect(cwd)) return backend
      } catch {
        /* probe failed — try the next backend */
      }
    }
    return null
  }
}
