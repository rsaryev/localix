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
