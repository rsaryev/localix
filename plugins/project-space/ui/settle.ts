import type { SpaceView } from '../shared/api'
import { same } from '../shared/ops/draft'

/**
 * The server's answer, taken in as a CHANGE to the board on screen rather than a new board.
 *
 * Every poll parses into fresh objects, so taking it as it came made every node of the board new
 * every 2.5 s: the flow library re-rendered thousands of elements for a board nobody had touched,
 * and the camera stuttered on each poll. An answer that says the same thing keeps the view that
 * is there; an answer that differs keeps each element and connector that did not change, so only
 * what changed is drawn again (`ui/board/toFlow.ts` reuses a node whose element is the same).
 *
 * "The same thing" is the file's revision plus what the view shows beside it. A view the person's
 * own change produced locally has NO revision (`LOCAL_REVISION`), so the server's answer to it is
 * always taken — a refused change must disappear, and its answer carries the old revision.
 */
export const LOCAL_REVISION = ''

export function settle(current: SpaceView | null, next: SpaceView): SpaceView {
  if (!current) return next
  const unchanged =
    current.revision !== LOCAL_REVISION &&
    current.revision === next.revision &&
    current.writable === next.writable &&
    current.canUndo === next.canUndo &&
    current.canRedo === next.canRedo &&
    current.liveUpdates === next.liveUpdates &&
    same(current.missing, next.missing) &&
    same(current.stamps, next.stamps) &&
    same(current.issues, next.issues)
  if (unchanged) return current
  return {
    ...next,
    space: {
      ...next.space,
      elements: keep(current.space.elements, next.space.elements),
      edges: keep(current.space.edges, next.space.edges),
    },
  }
}

/** `after`, with each record that equals its `before` replaced by that same object. */
function keep<T>(before: Record<string, T>, after: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [id, value] of Object.entries(after)) {
    const previous = before[id]
    out[id] = previous !== undefined && same(previous, value) ? previous : value
  }
  return out
}
