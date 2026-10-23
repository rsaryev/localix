import { useCallback, useMemo, useState } from 'react'

import {
  parseMergeConflicts,
  resolveMergeConflict,
  type MergeConflictChoice,
  type MergeConflictRegion,
} from './mergeConflicts'

export interface MergeConflictState {
  /** Every conflict block currently in the buffer, in file order. Empty for an ordinary file. */
  conflicts: MergeConflictRegion[]
  /** Which block the bar is pointing at, clamped as blocks are resolved away. */
  index: number
  /** Move the pointer and report the line to reveal, or `null` when there is nothing to move to. */
  navigate: (next: number) => number | null
  /** Take one side (or both) of the pointed-at block and write the result back. */
  resolve: (choice: MergeConflictChoice) => void
}

/**
 * Conflict resolution for whatever text the editor is holding.
 *
 * Core owns this, and deliberately knows nothing about git: `<<<<<<<` / `=======` / `>>>>>>>` in a
 * file is a TEXT fact, and a file carrying them is conflicted whether it arrived from a merge, a
 * rebase, a patch that half-applied, or an agent that wrote them by accident. The git mini app's
 * side of the arrangement is already written down in `useSourceControlDiffs`: opening a conflicted
 * path plainly "is what turns the resolver on", with no flag passed and no host contract to grow.
 *
 * State is derived from the buffer rather than stored beside it. A resolved block disappears from
 * the parse on the next render, which is what keeps the count honest — there is no second copy of
 * "how many conflicts are left" to fall out of step with the text.
 */
export function useMergeConflicts(
  text: string,
  onChange: (next: string) => void,
): MergeConflictState {
  const conflicts = useMemo(() => parseMergeConflicts(text), [text])
  const [rawIndex, setRawIndex] = useState(0)

  // Clamped on read, not on write: resolving the last block shrinks the list under a stored
  // index, and a bar pointing at conflict 3 of 2 is how that would show.
  const index = conflicts.length === 0 ? 0 : Math.min(rawIndex, conflicts.length - 1)

  const navigate = useCallback(
    (next: number): number | null => {
      if (conflicts.length === 0) return null
      // Wraps, so Next off the end returns to the first — a conflict list is a ring the user
      // walks, not a document they can run off.
      const wrapped = ((next % conflicts.length) + conflicts.length) % conflicts.length
      setRawIndex(wrapped)
      return conflicts[wrapped]?.startLine ?? null
    },
    [conflicts],
  )

  const resolve = useCallback(
    (choice: MergeConflictChoice) => {
      const region = conflicts[index]
      if (!region) return
      onChange(resolveMergeConflict(text, region, choice))
    },
    [conflicts, index, onChange, text],
  )

  return { conflicts, index, navigate, resolve }
}
