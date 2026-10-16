import type { SessionGitState } from './sessionState'

/**
 * Reactive identity for one inspector staging diff. A multi-root diff may stay
 * open while another repository is focused, so resolve its status from the
 * per-repo inventory instead of blindly reading the active status. The global
 * changeVersion catches content-only edits whose staged flags and line totals
 * happen to stay unchanged.
 */
export function sourceControlFileStamp(
  state: SessionGitState | undefined,
  path: string,
  repoRoot?: string,
): string {
  const status = repoRoot
    ? (state?.repos.find((repo) => repo.root === repoRoot)?.status ??
      (state?.activeRepo === repoRoot ? state.status : null))
    : state?.status
  const file = status?.files.find((candidate) => candidate.path === path)
  return file
    ? `${status?.changeVersion ?? ''}|${file.staged}|${file.unstaged}|${file.insertions}|${file.deletions}`
    : 'absent'
}
