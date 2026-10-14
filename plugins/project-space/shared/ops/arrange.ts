import type { SpaceElement } from '../format/document'
import type { AlignEdge, ArrangeOp, Axis, OpResult } from './contract'
import type { SpaceDraft } from './draft'
import { refuse, updateElement, type OpContext } from './elements'
import { frameOf, GAP, INSET, membersOf } from './geometry'
import { groupsOf, resolveTargets } from './groups'
import {
  alignUnits,
  arrangeUnits,
  boundsOfBoxes,
  distributeUnits,
  readingOrder,
  type Shift,
  type Unit,
} from './layout'

/**
 * `align`, `distribute` and `arrange` on the board: the targets become UNITS, the layout math
 * (`layout.ts`) gives each unit a shift, and every member moves by it through the ordinary
 * update — so a moved frame carries what it holds exactly as a dragged one does.
 *
 * A unit is a whole group when all of it is targeted, or one element. An element inside a frame
 * that is itself targeted is not a unit (the frame carries it; moving it too would move it
 * twice), and a locked element stays where it is.
 */
interface Units {
  units: Unit[]
  members: Map<string, string[]>
  locked: number
}

function unitsOf(draft: SpaceDraft, ids: readonly string[], ctx: OpContext): Units {
  const space = draft.document()
  const targeted = new Set(ids)
  const carried = new Set(ids.flatMap((id) => membersOf(space, id, ctx.registry)))
  const movable = ids.filter((id) => !carried.has(id) && !draft.elements[id]?.locked)
  const live = groupsOf(space)
  const cluster = (inside: ReadonlySet<string>) => {
    const members = new Map<string, string[]>()
    for (const id of movable) {
      const whole = (draft.elements[id]?.groups ?? []).findLast(
        (group) => !inside.has(group) && live.get(group)?.every((member) => targeted.has(member)),
      )
      const key = whole ?? id
      members.set(key, [...(members.get(key) ?? []), id])
    }
    return members
  }
  // Targets that are all ONE group mean its inside — "align these three" of a grouped legend —
  // so the layout reaches a level in, as a person clicking into the group would, until there
  // are parts to move. Kept as one unit, the group had nothing to align against and was refused.
  const inside = new Set<string>()
  let members = cluster(inside)
  while (members.size === 1 && live.has([...members.keys()][0] as string)) {
    inside.add([...members.keys()][0] as string)
    members = cluster(inside)
  }
  const units = [...members].map(([key, of]) => ({
    key,
    ...boundsOfBoxes(of.map((id) => draft.elements[id] as SpaceElement)),
  }))
  return { units, members, locked: ids.filter((id) => draft.elements[id]?.locked).length }
}

function shiftUnits(
  draft: SpaceDraft,
  { members }: Units,
  shifts: Map<string, Shift>,
  ctx: OpContext,
) {
  for (const [key, shift] of shifts) {
    const dx = Math.round(shift.dx)
    const dy = Math.round(shift.dy)
    if (dx === 0 && dy === 0) continue
    for (const id of members.get(key) ?? []) {
      const element = draft.elements[id] as SpaceElement
      updateElement(draft, { op: 'update', id, x: element.x + dx, y: element.y + dy }, ctx)
    }
  }
}

function done(ids: readonly string[], units: Units): OpResult {
  const held = units.locked ? `; ${units.locked} locked stayed put` : ''
  return { ok: true, id: ids[0] as string, note: `${units.units.length} moved as units${held}` }
}

export function alignElements(
  draft: SpaceDraft,
  targets: readonly string[],
  edge: AlignEdge,
  ctx: OpContext,
): OpResult {
  const resolved = resolveTargets(draft, targets)
  if ('error' in resolved) return resolved.error
  const units = unitsOf(draft, resolved.ids, ctx)
  if (units.units.length < 2) return refuse('aligning needs two things that can move')
  shiftUnits(draft, units, alignUnits(units.units, edge), ctx)
  return done(resolved.ids, units)
}

export function distributeElements(
  draft: SpaceDraft,
  targets: readonly string[],
  axis: Axis,
  ctx: OpContext,
): OpResult {
  const resolved = resolveTargets(draft, targets)
  if ('error' in resolved) return resolved.error
  const units = unitsOf(draft, resolved.ids, ctx)
  if (units.units.length < 3) return refuse('distributing needs three things that can move')
  shiftUnits(draft, units, distributeUnits(units.units, axis), ctx)
  return done(resolved.ids, units)
}

/**
 * Lay targets out in a row, a column or a grid. With `in`, the frame's own contents (in reading
 * order, unless `ids` name them) are laid out from its top-left, and the frame then fits around
 * them — the tidy-up an agent does after filling a frame one element at a time.
 */
export function arrangeElements(draft: SpaceDraft, op: ArrangeOp, ctx: OpContext): OpResult {
  const frame = op.in ? draft.elements[op.in] : undefined
  if (op.in && !frame) return refuse(`no frame "${op.in}"; read the board for the ids that exist`)
  if (op.in && frame && !ctx.registry.get(frame.type)?.container)
    return refuse(`"${op.in}" is a ${frame.type}, not a frame; "in" takes a frame`)
  if (!op.ids && !op.in) return refuse('arrange needs `ids`, or a frame `in` to arrange')

  let ids: string[]
  if (op.ids) {
    const resolved = resolveTargets(draft, op.ids)
    if ('error' in resolved) return resolved.error
    ids = resolved.ids
  } else {
    const space = draft.document()
    ids = membersOf(space, op.in as string, ctx.registry)
      .filter((id) => frameOf(space, id, ctx.registry) === op.in)
      .sort((a, b) => readingOrder(draft.elements[a]!, draft.elements[b]!))
  }
  const units = unitsOf(draft, ids, ctx)
  if (units.units.length === 0) return refuse('nothing to arrange: no unlocked elements')
  const origin = frame ? { x: frame.x + INSET, y: frame.y + INSET * 2 } : boundsOfBoxes(units.units)
  shiftUnits(
    draft,
    units,
    arrangeUnits(units.units, op.layout, origin, op.gap ?? GAP, op.columns),
    ctx,
  )
  if (frame && op.in) {
    const content = boundsOfBoxes(ids.map((id) => draft.elements[id] as SpaceElement))
    updateElement(
      draft,
      {
        op: 'update',
        id: op.in,
        w: content.x + content.w + INSET - frame.x,
        h: content.y + content.h + INSET - frame.y,
      },
      ctx,
    )
  }
  return done(ids, units)
}
