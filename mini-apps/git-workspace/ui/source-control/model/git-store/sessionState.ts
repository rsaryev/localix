import type {
  RepoStash,
  RepoWithStatus,
  SourceControlBranches,
  SourceControlStatus,
} from '../../../../backend/source-control/contracts'

/** Cached source-control state for one chat session's working directory. */
export interface SessionGitState {
  status: SourceControlStatus | null
  branches: SourceControlBranches | null
  /** Saved stash stack (newest first) — of the ACTIVE repo. */
  stashes: RepoStash[]
  /**
   * Every git repo discovered under the session's container dir, each with its
   * status. One entry for a normal project (the grouped Changes tree renders a
   * flat list then). Drives the multi-root grouped view.
   */
  repos: RepoWithStatus[]
  /** Root of the repo currently in focus — the one header/commit/log act on. */
  activeRepo: string | null
  /** A refresh is in flight (first load only — silent re-polls don't toggle this). */
  loading: boolean
  error: string | null
}

/**
 * The slice a session has before its first read. One frozen constant, so a
 * selector that falls back to it returns the SAME reference every call — a fresh
 * `{...}` fallback would re-render every subscriber on every store write.
 */
export const EMPTY_SESSION: SessionGitState = Object.freeze({
  status: null,
  branches: null,
  stashes: [],
  repos: [],
  activeRepo: null,
  loading: false,
  error: null,
}) as SessionGitState

/**
 * Choose the active repo after a repo-list refresh: keep the current focus when
 * it still exists, else the primary repo, else the first discovered — else null.
 */
export function pickActiveRepo(repos: RepoWithStatus[], current: string | null): string | null {
  if (current && repos.some((r) => r.root === current)) return current
  return repos.find((r) => r.isPrimary)?.root ?? repos[0]?.root ?? null
}
