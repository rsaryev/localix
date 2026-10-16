import { useCanvasCamera } from '@localixai/kit/canvas'
import type { SpaceDocument } from '../../shared/format/document'
import { newId, takenIn } from '../../shared/format/ids'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'
import { quickAddOps } from './quick-add'

/**
 * The board's gestures that MAKE something, each written as the operations the agent would send:
 *
 * - `grow`: the "+" beside one selected element, or ⌘ + arrow — a connected twin on that side;
 * - `connectEnd`: a connector released on empty ground makes a connected twin there;
 * - `noteAt`: a note on the ground, opened for writing — a double-click, or "Add a note here".
 */
type Side = 'top' | 'right' | 'bottom' | 'left'

export function useCreate({
  space,
  commit,
  select,
  setEditing,
}: {
  space: SpaceDocument
  commit: (ops: readonly SpaceOp[]) => void
  select: (ids: Iterable<string>) => void
  setEditing: (id: string | null) => void
}) {
  const camera = useCanvasCamera()
  const fresh = () => newId(takenIn(space))

  const grow = (id: string, side: Side) => {
    const twin = fresh()
    commit(quickAddOps(space, id, side, twin))
    select([twin])
  }

  const connectEnd = (
    event: MouseEvent | TouchEvent,
    state: { isValid: boolean | null; fromNode: { id: string } | null },
  ) => {
    const from = state.fromNode?.id
    const source = from ? space.elements[from] : undefined
    if (state.isValid || !from || !source || !('clientX' in event)) return
    const at = camera.toBoard(event.clientX, event.clientY)
    const twin = fresh()
    const ops = quickAddOps(space, from, 'right', twin)
    const create = ops[0]
    if (create?.op !== 'create') return
    commit([{ ...create, x: at.x - source.w / 2, y: at.y - source.h / 2 }, ...ops.slice(1)])
    select([twin])
  }

  const noteAt = (at: { x: number; y: number }) => {
    const size = spaceTypes.get('note')?.size ?? { w: 200, h: 200 }
    const id = fresh()
    commit([{ op: 'create', type: 'note', id, x: at.x - size.w / 2, y: at.y - size.h / 2 }])
    select([id])
    setEditing(id)
  }

  return { grow, connectEnd, noteAt }
}
