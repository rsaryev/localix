import { useMemo } from 'react'
import type { RepoFileChange } from '../../../backend/source-control/contracts'

/** A working tree's changes split the way the panel shows them: Merge / Staged / Changes. */
export interface ChangeGroups {
  conflicts: RepoFileChange[]
  staged: RepoFileChange[]
  changed: RepoFileChange[]
}

/**
 * One pass over the change list. An unmerged path is neither staged nor unstaged
 * in the ordinary sense, so it lives in `conflicts` alone; any other path can be
 * in both `staged` and `changed` (a partially staged file).
 */
export function partitionChanges(files: readonly RepoFileChange[]): ChangeGroups {
  const groups: ChangeGroups = { conflicts: [], staged: [], changed: [] }
  for (const file of files) {
    if (file.status === 'conflicted') {
      groups.conflicts.push(file)
      continue
    }
    if (file.staged) groups.staged.push(file)
    if (file.unstaged) groups.changed.push(file)
  }
  return groups
}

/**
 * The partition, memoized on the file list's identity.
 *
 * Without it every render re-filtered each repo's list three times and handed
 * each Changes tree a NEW array, which rebuilt and re-sorted that tree even when
 * the poll had changed nothing. The store keeps `status.files` referentially
 * stable across unchanged polls, so keying on it makes an idle panel free.
 */
export function useChangeGroups(files: readonly RepoFileChange[]): ChangeGroups {
  return useMemo(() => partitionChanges(files), [files])
}
