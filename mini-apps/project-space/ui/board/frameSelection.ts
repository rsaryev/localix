import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { frameAroundOps } from './commands'

/**
 * Put the selection in a new frame, select the frame and open its title for typing — the one
 * answer ⌥⌘G and the right-click menu share, so naming the area is the next keystroke.
 */
export function frameSelection(
  board: {
    space: SpaceDocument
    entered: string | null
    commit: (ops: readonly SpaceOp[]) => void
    select: (ids: Iterable<string>) => void
    setEditing: (id: string | null) => void
  },
  ids: readonly string[],
): boolean {
  const framed = frameAroundOps({ space: board.space, ids, entered: board.entered })
  if (!framed) return false
  board.commit(framed.ops)
  board.select([framed.id])
  board.setEditing(framed.id)
  return true
}
