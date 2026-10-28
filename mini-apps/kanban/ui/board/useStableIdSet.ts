import { useState } from 'react'

/**
 * A `Set` whose IDENTITY only changes when its CONTENTS change.
 *
 * `useMemo` keys on the source array's identity, which is the wrong granularity
 * here: every board stream frame rebuilds the task list, so a `useMemo`-derived
 * `doneIds` got a fresh identity on every frame even though no task finished. That
 * new identity is a changed prop on every card, so `memo(TaskCard)` could never
 * bail out and one card's update re-rendered the whole board. Comparing contents
 * (O(n) over ids, which we already paid to build them) buys back the bail-out.
 */
export function useStableIdSet(ids: Iterable<string>): Set<string> {
  const next = ids instanceof Set ? ids : new Set(ids)
  const [held, setHeld] = useState<Set<string>>(next)
  if (held === next) return held
  if (held.size === next.size) {
    let same = true
    for (const id of next) {
      if (!held.has(id)) {
        same = false
        break
      }
    }
    if (same) return held
  }
  // Adjusting state while rendering is React's own pattern for "state derived from props": React
  // re-runs this component at once with the new set, and that second pass finds equal contents.
  setHeld(next)
  return next
}
