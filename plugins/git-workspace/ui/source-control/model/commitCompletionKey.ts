import type { SourceControlStatus } from '../../../backend/source-control/contracts'

/**
 * The commit-message completion's client-side cache key: repo, branch, and the change set.
 *
 * Git status already supplies a compact hash over file identity, index state and worktree
 * metadata (`changeVersion`), so hundreds of paths are not serialized into every completion key;
 * a backend without the hash falls back to the file list itself.
 */
export function commitCompletionKey(
  repoRoot: string | undefined,
  status: SourceControlStatus | null,
): string {
  const files = status?.files ?? []
  const changeVersion =
    status?.changeVersion ??
    files.map((f) => [f.path, f.status, f.staged, f.unstaged, f.insertions, f.deletions])
  return JSON.stringify([repoRoot ?? status?.root ?? '', status?.branch ?? '', changeVersion])
}
