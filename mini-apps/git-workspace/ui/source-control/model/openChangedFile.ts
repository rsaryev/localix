import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { mediaTypeForPath } from '@localixai/mini-app-sdk/ui/file-types'
import type { RepoFileChange } from '../../../backend/source-control/contracts'
import { sourceControlApi } from '../../api'
import { gitFailed } from './gitFailure'

/** Join a repo root with a repo-relative git path into an on-disk absolute path. */
export function toAbsPath(root: string | undefined, path: string): string {
  return root ? `${root.replace(/\/$/, '')}/${path}` : path
}

/** Existing binary/media files use the same viewer as a file opened from Explorer. */
function opensAsFile(file: RepoFileChange): boolean {
  if (file.status === 'deleted') return false
  const mediaType = mediaTypeForPath(file.path)
  return (
    file.binary === true ||
    (mediaType !== undefined && mediaType !== 'text/csv' && !mediaType.endsWith('+xml'))
  )
}

export async function openChangedFile(
  sessionId: string,
  file: RepoFileChange,
  staged: boolean,
  root: string | undefined,
): Promise<void> {
  const absPath = toAbsPath(root, file.path)
  // An unmerged entry opens as the file itself: the editor finds the conflict markers and
  // turns its resolver on, which is the only surface that can resolve them.
  if (file.status === 'conflicted' || opensAsFile(file)) {
    miniAppWorkspace.openFile({ sessionId, path: absPath })
    return
  }
  // A tracked text change opens straight into the staging pane, which fetches its own
  // indexed lines — fetching the unified text here as well read every such file twice.
  if (file.status !== 'untracked' && file.status !== 'deleted') {
    miniAppWorkspace.openDiff({
      sessionId,
      path: absPath,
      diff: '',
      title: baseName(file.path),
      staging: {
        sessionId,
        path: file.path,
        mode: staged ? 'staged' : 'unstaged',
        repoRoot: root,
      },
    })
    return
  }
  // Untracked and deleted files have no index/HEAD side to stage lines against.
  try {
    const d = await sourceControlApi.getFileDiff(
      sessionId,
      absPath,
      { staged, untracked: file.status === 'untracked' },
      root,
    )
    if (d.binary && file.status !== 'deleted') {
      miniAppWorkspace.openFile({ sessionId, path: absPath })
      return
    }
    miniAppWorkspace.openDiff({
      sessionId,
      path: absPath,
      diff: d.diff,
      title: baseName(file.path),
      deleted: file.status === 'deleted',
      truncated: d.truncated,
    })
  } catch (err) {
    gitFailed('Could not load the file diff', err)
  }
}
