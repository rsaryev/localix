/**
 * The source-control DOMAIN MODEL — what a working tree, its history, and an
 * in-progress rewrite ARE, in VCS-neutral terms. `git` is one backend (see
 * ports.ts), not the vocabulary: adding a second backend must not require new
 * shapes here. Shared verbatim with the UI via `apps/api/src/client.ts`.
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
import type { Prerequisite } from '@localixai/plugin-sdk/prerequisite'

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

export interface RepoBranch {
  name: string
  current: boolean
  /** Relative authored date of the branch tip (e.g. "3 days ago"). */
  updatedAt?: string
  /** Tracking branch short name, when configured. */
  upstream?: string
  /** Commits this branch is ahead of its upstream (0 when in sync or no upstream). Stale until a fetch. */
  ahead: number
  /** Commits this branch is behind its upstream (0 when in sync or no upstream). Stale until a fetch. */
  behind: number
  /**
   * Absolute path of ANOTHER worktree that has this branch checked out, when one
   * does. Set only for branches NOT current in this cwd — git forbids checking
   * out the same branch in two worktrees, so such a branch can't be switched to
   * here (e.g. `main`, held by the primary checkout, from a session worktree).
   */
  worktreePath?: string
}

/**
 * A branch that exists on a remote but has no local counterpart yet — what
 * `git branch -r` lists, minus the ones already tracked locally. Offered so a
 * teammate's branch can be checked out without dropping to a terminal; picking
 * one creates the local tracking branch (`git switch --track`).
 */
export interface RepoRemoteBranch {
  /** Full remote-tracking ref short name, e.g. `origin/feature-x`. */
  name: string
  /** The remote it lives on, e.g. `origin`. */
  remote: string
  /** The branch name WITHOUT the remote prefix — the local name a checkout creates. */
  shortName: string
  /** Relative committer date of the tip (e.g. "3 days ago"). */
  updatedAt?: string
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
  DiffLineKind,
  FileDiff,
  FileDiffInput,
  FileDiffLines,
  FileHunks,
  LineStageMode,
  RangeDiff,
  RepoDiffLine,
  RepoFileHunk,
} from './diff-contracts'

/**
 * One saved stash entry. VCS-neutral: a "stash" is a named snapshot of
 * uncommitted work set aside off the working tree — a general concept, not a git
 * one. `index` is the position in the stack (0 = most recent), the ref used to
 * apply/pop/drop it.
 */
export interface RepoStash {
  /** 0-based position in the stash stack (0 = most recent). The apply/pop/drop target. */
  index: number
  /** Human description, e.g. `On main: WIP` or the auto `WIP on main: <sha> <subject>`. */
  message: string
  /** Branch the stash was created on, when parseable from the message. */
  branch?: string
  /** Human relative date the stash was created (e.g. "3 days ago"). */
  relativeDate?: string
}

/**
 * What kind of ref decorates a commit in the log. VCS-neutral: "a named pointer
 * at a commit" is a general concept. `head` = the detached-HEAD marker; `branch` =
 * a local branch; `remote` = a remote-tracking branch (shown dimmed); `tag` = a
 * tag (distinct glyph).
 */
export type RepoRefKind = 'head' | 'branch' | 'remote' | 'tag'

/**
 * One ref decoration on a commit — a branch head, remote-tracking branch, tag, or
 * the detached-HEAD marker. Rendered as a chip on the commit row. `current` is set
 * on the local branch the checked-out HEAD points at (`HEAD -> <branch>`), so the
 * UI can highlight it.
 */
export interface RepoRef {
  kind: RepoRefKind
  /** Display name — short branch/tag name, e.g. `main`, `origin/main`, `v1.2.0`. */
  name: string
  /** True for the local branch HEAD currently points at. */
  current?: boolean
}

export interface RepoCommit {
  hash: string
  shortHash: string
  subject: string
  author: string
  /** Human relative date, e.g. "3 days ago". */
  relativeDate: string
  /** True when this commit carries a localix provenance note (`refs/notes/localix`). */
  hasNote?: boolean
  /** Ref decorations (branch heads, tags, remotes, HEAD) pointing at this commit. */
  refs?: RepoRef[]
  /**
   * Parent commit hashes (`%P`), oldest-graph-order as git prints them (first
   * parent first). Drives the commit-graph lane/rail visualization: a merge has
   * 2+ parents, the root commit has none. Omitted when there are no parents.
   */
  parents?: string[]
}

/**
 * Provenance recorded on a commit made through OUR commit path, stored as a git
 * note on `refs/notes/localix` (NOT a DB row — git is the source of truth). Read
 * back to surface a provenance header above the commit diff + a timeline badge.
 *
 * v1 SCOPE: only commits through the source-control commit service are annotated;
 * commits the agent makes by calling the bash tool directly (`git commit ...`)
 * are NOT noted.
 */
export interface CommitNote {
  /** The chat session the commit was made from, when known. */
  sessionId: string | null
  /** Session model id at commit time, when resolvable. */
  model?: string
  /** Session agent mode at commit time, when resolvable. */
  /** Optional free-form rationale (the commit subject today). */
  rationale?: string
  /** ISO timestamp the note was written. */
  createdAt: string
}

/**
 * Optional filter for the commit log, mapped to `git log` args by the backend.
 * All fields are ANDed; an empty/omitted filter yields the normal log. VCS-neutral
 * — a second backend maps these three intents onto its own history query.
 */
export interface LogFilter {
  /** Match commit MESSAGES (`git log --grep`, case-insensitive). */
  query?: string
  /** Match the commit AUTHOR name/email (`git log --author`, case-insensitive). */
  author?: string
  /** Only commits that touched this repo-relative PATH (`git log -- <path>`). */
  path?: string
}
