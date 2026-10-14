import type { SpaceElement } from '../format/document'
import { bottomKey, byOrder, keysBetween, topKey } from '../format/order'
import type { OpResult, Stacking } from './contract'
import type { SpaceDraft } from './draft'
import type { OpContext } from './elements'
import { overlaps } from './geometry'
import { resolveTargets } from './groups'

/**
 * Stacking a set of elements together, their order among themselves kept.
 *
 * `front` and `back` go past everything. `forward` and `backward` go one step, and a step is the
 * next element that OVERLAPS the set: stepping past an element on the far side
 * of the board changes nothing visible, so a person pressed ⌘] five times and saw nothing move.
 *
 * Frames are a layer of their own, always drawn below the rest (`ui/board/toFlow.ts`), so a set
 * is stacked within each layer it has members in; stepping a note past a frame would be a step
 * nobody could see.
 */
type Placed = SpaceElement & { id: string }

const UNMOVED: Record<Stacking, string> = {
  front: 'already in front',
  back: 'already at the back',
  forward: 'unchanged: nothing above overlaps it',
  backward: 'unchanged: nothing below overlaps it',
}

export function stackElements(
  draft: SpaceDraft,
  targets: readonly string[],
  to: Stacking,
  ctx: OpContext,
): OpResult {
  const resolved = resolveTargets(draft, targets)
  if ('error' in resolved) return resolved.error
  const chosen = new Set(resolved.ids)
  const layerOf = (element: SpaceElement) => ctx.registry.get(element.type)?.container === true
  const all = Object.entries(draft.elements).map(([id, element]) => ({ id, ...element }))
  let moved = 0
  for (const layer of [true, false]) {
    const inLayer = all.filter((element) => layerOf(element) === layer).sort(byOrder)
    const set = inLayer.filter((element) => chosen.has(element.id))
    if (set.length === 0) continue
    const rest = inLayer.filter((element) => !chosen.has(element.id))
    const keys = keysFor(set, rest, to)
    if (!keys) continue
    set.forEach(({ id, ...element }, index) => {
      draft.setElement(id, { ...element, z: keys[index] as string })
    })
    moved += set.length
  }
  const [first] = resolved.ids
  if (!moved) return { ok: true, id: first as string, note: UNMOVED[to] }
  return { ok: true, id: first as string, ...(moved > 1 ? { note: `${moved} elements` } : {}) }
}

/** The new keys for a set (lowest first), or null when the set is already where it is sent. */
function keysFor(set: Placed[], rest: Placed[], to: Stacking): string[] | null {
  const low = set[0] as Placed
  const high = set.at(-1) as Placed
  const touches = (other: Placed) => set.some((element) => overlaps(element, other))
  if (to === 'front') {
    const top = topKey(rest)
    return top === null || top < low.z ? null : keysBetween(top, null, set.length)
  }
  if (to === 'back') {
    const bottom = bottomKey(rest)
    return bottom === null || bottom > high.z ? null : keysBetween(null, bottom, set.length)
  }
  if (to === 'forward') {
    const past = rest.find((other) => other.z > high.z && touches(other))
    if (!past) return null
    const next = rest.find((other) => other.z > past.z)
    return keysBetween(past.z, next?.z ?? null, set.length)
  }
  const past = rest.findLast((other) => other.z < low.z && touches(other))
  if (!past) return null
  const previous = rest.findLast((other) => other.z < past.z)
  return keysBetween(previous?.z ?? null, past.z, set.length)
}
