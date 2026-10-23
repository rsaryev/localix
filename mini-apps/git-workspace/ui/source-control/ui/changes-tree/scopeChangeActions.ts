import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import type { RepoFileChange } from '../../../../backend/source-control/contracts'
import type { ChangeActions } from '../../model/changeActions'

/** Expand directory actions only to paths represented in this index group. */
export function scopeChangeActions(actions: ChangeActions, files: RepoFileChange[]): ChangeActions {
  // These are raw Git-relative identities, not normalized filesystem paths. Pass the exact
  // directory prefix so an empty or slash-terminated selection keeps its existing meaning.
  const expand = (paths: string[]) =>
    files
      .filter((file) =>
        paths.some((path) => file.path === path || isAtOrUnder(`${path}/`, file.path)),
      )
      .map((file) => file.path)
  return {
    ...actions,
    onStage: (paths) => actions.onStage(expand(paths)),
    onUnstage: (paths) => actions.onUnstage(expand(paths)),
    onDiscard: (paths, label) => actions.onDiscard(expand(paths), label),
  }
}
