import { FileDiff, FolderGit2, Minus, Plus } from 'lucide-react'
import type { RepoFileChange, RepoWithStatus } from '../../../backend/source-control/contracts'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'

/** Stage/unstage handlers, already scoped to the repo whose header opened the menu. */
export interface RepoGroupMenuOps {
  onOpenAllDiff: () => void
  onStageAll: (paths: string[]) => void
  onUnstageAll: (paths: string[]) => void
}

/**
 * A repo group header's menu.
 *
 * Stage-all and unstage-all exist elsewhere only as tiny icons on the "Staged"/"Changes"
 * sub-labels INSIDE the expanded body — invisible while the group is collapsed, which is exactly
 * when a person wants to stage a whole repo. Rows are disabled rather than absent so the header
 * always offers the same shape and says WHY an action is unavailable by looking unavailable.
 */
export function repoGroupMenu(
  repo: RepoWithStatus,
  changed: RepoFileChange[],
  staged: RepoFileChange[],
  ops: RepoGroupMenuOps,
): MenuEntry[] {
  return [
    {
      id: 'diff',
      label: 'Open full diff',
      icon: FileDiff,
      disabled: repo.status.files.length === 0,
      onSelect: ops.onOpenAllDiff,
    },
    { separator: true },
    {
      id: 'stage-all',
      label: 'Stage all changes',
      icon: Plus,
      disabled: changed.length === 0,
      onSelect: () => ops.onStageAll(changed.map((file) => file.path)),
    },
    {
      id: 'unstage-all',
      label: 'Unstage all',
      icon: Minus,
      disabled: staged.length === 0,
      onSelect: () => ops.onUnstageAll(staged.map((file) => file.path)),
    },
    { separator: true },
    {
      id: 'copy-path',
      label: 'Copy repository path',
      icon: FolderGit2,
      onSelect: () => void copyText(repo.root, 'Repository path'),
    },
  ]
}
