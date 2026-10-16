/**
 * When a reveal request turns into a scroll — the tree's one deliberate scroll.
 *
 * Everything else about the explorer's scroll position belongs to the virtualizer and to the
 * user's wheel. A reveal ("show me this file") is the exception, and it arrives as a semantic
 * PATH: the row may not be mounted, or may not exist in the row model yet, because its ancestors
 * are still loading. So the request lingers in state until the model catches up.
 *
 * That lingering is what made the decision worth extracting. The effect consuming it re-ran on the
 * path→row-index map, which is rebuilt by every expand, collapse and watcher refresh — so once a
 * reveal had been served, opening ANY folder re-centred the tree on that same old file. The scroll
 * "jumping somewhere else" was a completed request being served again, forever.
 *
 * The rule: serve each `intent` at most once, and only once the path actually maps to a row.
 */

export interface RevealRequest {
  path: string
  intent: number
}

/**
 * The row index to scroll to, or `null` to leave the scroll position alone.
 *
 * `handledIntent` is the last intent this consumer served. Returning an index means the caller
 * scrolls AND records the intent; returning `null` while the path is still unmapped deliberately
 * leaves the intent unrecorded, so the next row-model change retries.
 */
export function revealScrollIndex(
  request: RevealRequest | null,
  handledIntent: number | null,
  indexOfPath: (path: string) => number | undefined,
): number | null {
  if (!request) return null
  if (handledIntent === request.intent) return null
  return indexOfPath(request.path) ?? null
}
