/**
 * The source-control DOMAIN MODEL — what a working tree, its history, and an
 * in-progress rewrite ARE, in VCS-neutral terms. `git` is one backend (see
 * ports.ts), not the vocabulary: adding a second backend must not require new
 * shapes here. Shared by the mini app backend and UI.
 *
 * The HTTP request schemas that VALIDATE INTO this model live next door in
 * `requests.ts` — they change when a route changes, which is a different reason
 * than the model changing. Nothing here knows about HTTP.
 *
 * `zod` appears only for the three closed vocabularies (bisect term, reset mode,
 * rebase action), each declared beside the type it enumerates so the members have
 * ONE definition point.
 */
import { z } from 'zod'
import type { Prerequisite } from '@localixai/mini-app-sdk/prerequisite'
import type { RepoBranch, RepoRemoteBranch, RepoCommit, RepoStash } from './history-contracts'

export type {
  RepoBranch,
  RepoRemoteBranch,
  RepoStash,
  RepoRefKind,
  RepoRef,
  RepoCommit,
  CommitNote,
  LogFilter,
} from './history-contracts'

/** How a single path differs from the committed tree. VCS-neutral. */
export type RepoChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'typechange'
  | 'unknown'

/** One changed path in the working tree, with its line delta. */
export interface RepoFileChange {
  path: string
  /** Pre-rename/-copy path, when `status` is `renamed`/`copied`. */
  oldPath?: string
  status: RepoChangeStatus
  /** Has changes recorded in the index (ready to commit). */
  staged: boolean
  /** Has changes in the working tree not yet recorded (includes untracked). */
  unstaged: boolean
  insertions: number
  deletions: number
  /** Git reports a binary change rather than text lines. */
  binary?: boolean
}

/** Aggregate working-tree state, independent of whether a repo was found. */
export interface RepoStatus {
  /** Absolute repository top-level. File `path`s are relative to this — join to resolve. */
  root: string | null
  /**
   * Full sha of HEAD; null on an unborn branch. Optional for non-git backends. Views keyed on
   * HEAD (the commit graph, the HEAD message) read it so a commit made OUTSIDE the panel — an
   * agent, a terminal — is seen on the next poll even when no counter it moved is visible.
   */
  head?: string | null
  /** Current branch name; null when detached or on an unborn branch. */
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  files: RepoFileChange[]
  stats: { files: number; insertions: number; deletions: number }
  /**
   * Content-free fingerprint of changed-path metadata (path/state/size/mtime)
   * plus the staged index identity. It invalidates server-resolved completion
   * context after same-line-count edits and partial staging changes. Optional
   * for non-filesystem VCS backends.
   */
  changeVersion?: string
  /** Set ONLY while a rebase is in progress (conflict/stop); drives the header banner. */
  rebase?: RebaseState
  /** Set ONLY while a git bisect session is in progress; drives the bisect banner. */
  bisect?: BisectState
}

/**
 * How the currently-checked-out commit is being marked during a bisect. `bad` =
 * the regression is present here; `good` = it works here; `skip` = untestable
 * (build broken, etc.) — git picks a nearby commit instead. VCS-neutral vocabulary.
 */
export type BisectTerm = 'good' | 'bad' | 'skip'
export const bisectTermSchema = z.enum(['good', 'bad', 'skip'])

/**
 * State of an in-progress `git bisect` — a binary search for the commit that
 * introduced a regression. Present on `RepoStatus.bisect` ONLY while a session is
 * underway; drives the Source Control header banner. `current` is the commit
 * checked out for testing (HEAD, detached); once the search concludes,
 * `firstBadCommit` names the culprit and the banner surfaces a Reset to finish.
 * `revisionsLeft`/`stepsLeft` are progress hints from the last mark (git does not
 * persist them, so they're absent on a fresh status read after a page reload).
 */
export interface BisectState {
  /** Always true when this object is present (a bisect is underway). */
  bisecting: boolean
  /** The commit currently checked out for the user to test, when readable. */
  current?: RepoCommit
  /** Revisions still to test after the current one, from the last mark's output. */
  revisionsLeft?: number
  /** Rough remaining steps, from the last mark's output. */
  stepsLeft?: number
  /** The identified first-bad commit — set only once the search has concluded. */
  firstBadCommit?: RepoCommit
}

/**
 * State of an in-progress history rewrite (a rebase interrupted by a conflict or
 * a manual stop). Present on `RepoStatus.rebase` ONLY while the working tree is
 * mid-rebase; absent otherwise. VCS-neutral: "a paused replay of commits that
 * needs continue/abort/skip" is a general concept. Drives the Source Control
 * header banner; the conflicted files surface in the normal Changes tree.
 */
export interface RebaseState {
  /** Always true when this object is present (a rebase is underway). */
  rebasing: boolean
  /** 1-based index of the step git is on, when readable from the rebase dir. */
  step?: number
  /** Total number of steps in the rebase, when readable. */
  total?: number
  /** Short sha the branch is being replayed onto, when readable. */
  onto?: string
}

/**
 * What to do with one commit in a rebase todo. `pick` keeps it; `reword` keeps
 * its changes but replaces the message; `squash`/`fixup` fold it into the
 * PRECEDING kept commit (squash combines messages, fixup discards this one's);
 * `drop` removes it entirely. VCS-neutral vocabulary — a second backend maps
 * these onto its own replay primitives.
 */
export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'
export const rebaseActionSchema = z.enum(['pick', 'reword', 'squash', 'fixup', 'drop'])

/** One row of a composed rebase todo: a commit + the action to apply to it. */
export interface RebaseTodoEntry {
  /** Full sha of the commit this row acts on. */
  hash: string
  action: RebaseAction
  /** New message — required for `reword`, ignored otherwise. */
  message?: string
}

/**
 * How far a reset moves the branch ref AND what it does to the index/working
 * tree. `soft` moves the ref only (changes become staged); `mixed` also resets
 * the index (changes become unstaged, working tree kept); `hard` also discards
 * the working tree (DESTRUCTIVE — uncommitted work is lost). VCS-neutral enough
 * that a second backend can map these three intents onto its own primitives.
 */
export type ResetMode = 'soft' | 'mixed' | 'hard'
export const resetModeSchema = z.enum(['soft', 'mixed', 'hard'])

/** `RepoStatus` plus the envelope the service adds (repo presence + backend id). */
export interface SourceControlStatus extends RepoStatus {
  isRepo: boolean
  /** Identifier of the backend that resolved the repo (e.g. `git`), or null. */
  vcs: string | null
  /**
   * The session's directory is not known yet (the host has not bound it, e.g. during startup).
   * `isRepo: false` alone read as "not a git repository" and stopped the panel's polling, so a
   * session whose directory resolved a second later stayed "not a repo" until a remount.
   */
  unresolved?: boolean
  /**
   * Set when `isRepo: false` is really "git is not installed". Without it a machine with no git
   * read "Not a git repository" — a false statement about the directory, with no way out.
   */
  prerequisite?: Prerequisite
}

/**
 * Server-resolved context for completing a commit-message input. This never
 * crosses the public source-control HTTP API: the inline-completion adapter
 * turns it into a bounded prompt fragment on the server.
 */
export interface CommitCompletionContext {
  branch: string | null
  /** Complete file inventory for the exact change set the next commit will contain. */
  files: RepoFileChange[]
  /** Complete tracked stat when Git can provide it; untracked scope remains in `files`. */
  stat: string
  /** Complete for ordinary patches, bounded representative evidence for very large ones. */
  diff: string
  staged: boolean
  recentMessages: string[]
}

/**
 * One repository in a multi-root project (a container dir holding several
 * independent git repos), with its full working-tree status. Powers the
 * Source Control "changes grouped by repository" view and the active-repo
 * switcher. When only one repo is discovered the UI renders a flat list.
 */
export interface RepoWithStatus {
  /** Absolute repository root. The `repoRoot` echoed back on scoped operations. */
  root: string
  /** Display name — repo path relative to the container (or its basename). */
  name: string
  /** The repo the session's base cwd resolves to today (the default active repo). */
  isPrimary: boolean
  /** Full working-tree status of this repo (same envelope as `getStatus`). */
  status: SourceControlStatus
}

export interface SourceControlBranches {
  isRepo: boolean
  vcs: string | null
  current: string | null
  branches: RepoBranch[]
  /**
   * Remote branches with no local counterpart. Empty for a repo with no remote,
   * and stale until a fetch — the same caveat `RepoBranch.ahead/behind` carry.
   */
  remotes: RepoRemoteBranch[]
}

/**
 * Everything the Source Control panel reads, in ONE round trip.
 *
 * It used to be four (`/repos`, `/status`, `/branches`, `/stashes`), which cost
 * four HTTP requests, four repo resolutions — and, because `/repos` already
 * computes a status for EVERY discovered repo, a second full `git status` of the
 * active one that could also disagree with the first (two snapshots, one tree).
 * Served together, the active repo's status is the one discovery already read.
 */
export interface SourceControlWorkspace {
  /** Every repo discovered under the session's container dir, each with status. */
  repos: RepoWithStatus[]
  /** The repo the detail below describes — the requested one when it still exists. */
  activeRepo: string | null
  status: SourceControlStatus
  branches: SourceControlBranches
  stashes: RepoStash[]
}

/**
 * {@link SourceControlWorkspace} as the `/workspace` route sends it: `status` is left out when it
 * IS the active repo's row in `repos`, and the client restores it from there. The focused status
 * used to ride the wire twice — at 5,000 changed files, a megabyte of JSON per poll serialized,
 * sent and parsed for nothing.
 */
export type SourceControlWorkspaceWire = Omit<SourceControlWorkspace, 'status'> & {
  status?: SourceControlStatus
}

/**
 * The result of a WRITE: the refreshed status, plus whichever neighbouring lists
 * that particular write could have invalidated.
 *
 * Every mutating op used to answer with the status alone, so the UI followed each
 * one with a full workspace re-read to pick up (say) the branch that had just
 * been deleted — a second wave of requests, gated behind whatever poll happened
 * to be in flight. Naming the invalidated lists here makes the write's own
 * response sufficient: one request, one repaint.
 */
export interface SourceControlMutation {
  status: SourceControlStatus
  /** Present when the op could change branch identity/ahead-behind (checkout, commit, push, …). */
  branches?: SourceControlBranches
  /** Present when the op could change the stash stack. */
  stashes?: RepoStash[]
}

/**
 * Diff-shaped contracts (patch / hunks / stageable lines / range / blame) live
 * in their own file — they share no vocabulary with the status and branch types
 * above. Re-exported so importers still read `from ./contracts`.
 */
export type {
  BlameLine,
  FileDiff,
  FileDiffInput,
  FileDiffLines,
  LineStageMode,
  RangeDiff,
  RepoDiffLine,
  RepoFileHunk,
} from './diff-contracts'
