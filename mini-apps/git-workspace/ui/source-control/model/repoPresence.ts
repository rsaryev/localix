import type { SourceControlStatus } from '../../../backend/source-control/contracts'

/**
 * Whether a session has a repository, as the panel and the poller must read it.
 *
 * `isRepo: false` used to be taken as a verdict on its own. At startup the session's directory is
 * often not bound yet, so the first status answered `isRepo: false` for a directory nobody had
 * looked at: the panel said "Not a git repository" and the poller stopped its interval, leaving
 * the verdict in place until a focus change or a remount re-probed. An answer the backend marks
 * `unresolved` is therefore PENDING — shown as loading and polled again — and only a resolved
 * directory with no repository is `not-repo`.
 */
export type RepoPresence = 'pending' | 'repo' | 'not-repo'

export function repoPresence(status: SourceControlStatus | null | undefined): RepoPresence {
  if (!status || status.unresolved) return 'pending'
  return status.isRepo ? 'repo' : 'not-repo'
}
