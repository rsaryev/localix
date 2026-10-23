import { lastLine } from './lastLook'
import type { SpaceDocument } from '../../shared/format/document'
import type { Side } from '../../shared/format/schema'
import type { SpaceOp } from '../../shared/ops/contract'
import { overlaps } from '../../shared/ops/geometry'

/**
 * Quick create: a twin of an element on one side, connected to it — the move that makes a
 * flowchart or a mind map a sequence of clicks (the "+" beside an element, or ⌘+arrow).
 *
 * The twin takes the element's type, size and look but not its text, and lands `GAP` away; if
 * something is already there it steps further out along that side until the spot is free, so
 * repeated clicks fan out instead of stacking.
 */
const GAP = 80
const LOOK = ['color', 'kind', 'fill', 'stroke', 'size'] as const

export function quickAddOps(
  space: SpaceDocument,
  id: string,
  side: Side,
  newId: string,
): SpaceOp[] {
  const source = space.elements[id]
  if (!source) return []
  const props: Record<string, unknown> = {}
  for (const key of LOOK) if (source.props[key] !== undefined) props[key] = source.props[key]
  const step = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side]
  const across = { top: [1, 0], bottom: [1, 0], left: [0, 1], right: [0, 1] }[side]
  let x = source.x + step[0]! * (source.w + GAP)
  let y = source.y + step[1]! * (source.h + GAP)
  const others = Object.values(space.elements)
  for (let tries = 0; tries < 20; tries++) {
    const box = { x, y, w: source.w, h: source.h }
    if (!others.some((other) => overlaps(box, other))) break
    x += across[0]! * (source.w + GAP / 2)
    y += across[1]! * (source.h + GAP / 2)
  }
  return [
    { op: 'create', type: source.type, id: newId, x, y, w: source.w, h: source.h, props },
    { op: 'connect', from: id, to: newId, ...lastLine() },
  ]
}
