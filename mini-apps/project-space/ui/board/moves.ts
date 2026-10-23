import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { membersOf } from '../../shared/ops/geometry'
import type { TypeRegistry } from '../../shared/registry/registry'

/**
 * What a finished drag writes. The drag itself is shown locally, frame contents following the
 * frame; the board is written ONCE, when the pointer is released.
 *
 * A dragged frame is written as the frame's own move, and the server moves what it holds (the
 * same rule an agent's move gets). So an element inside a dragged frame writes no move of its
 * own — otherwise it would be moved twice, once as the frame's content and once by itself.
 */
export interface Dragged {
  id: string
  x: number
  y: number
}

export function dragOps(
  space: SpaceDocument,
  dragged: readonly Dragged[],
  registry: TypeRegistry,
): SpaceOp[] {
  const moved = dragged.filter((node) => {
    const element = space.elements[node.id]
    return (
      element &&
      (Math.round(element.x) !== Math.round(node.x) || Math.round(element.y) !== Math.round(node.y))
    )
  })
  const carried = new Set(
    moved.flatMap((node) =>
      registry.get(space.elements[node.id]?.type ?? '')?.container
        ? membersOf(space, node.id, registry)
        : [],
    ),
  )
  const isFrame = (id: string) => registry.get(space.elements[id]?.type ?? '')?.container === true
  return moved
    .filter((node) => !carried.has(node.id))
    .sort((a, b) => Number(isFrame(b.id)) - Number(isFrame(a.id)))
    .map((node) => ({ op: 'update', id: node.id, x: Math.round(node.x), y: Math.round(node.y) }))
}

/** An arrow-key nudge of a selection: the same writes a drag by that much would make. */
export function nudgeOps(
  space: SpaceDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
  registry: TypeRegistry,
): SpaceOp[] {
  const movable = ids.flatMap((id) => {
    const element = space.elements[id]
    return element && !element.locked ? [{ id, x: element.x + dx, y: element.y + dy }] : []
  })
  return dragOps(space, movable, registry)
}

export interface Follower {
  id: string
  dx: number
  dy: number
}

/**
 * What follows a drag on screen, by the dragged element it follows: a frame's contents, and the
 * rest of a dragged element's group. The library drags only the nodes it had selected when the
 * pointer went down — a grouped element dragged straight from rest left its group behind — so
 * the group's other members are carried here, and written with the drag when it ends.
 */
export function followersOf(
  space: SpaceDocument,
  dragged: readonly string[],
  groupOf: (id: string) => readonly string[],
  registry: TypeRegistry,
): Map<string, Follower[]> {
  const moving = new Set(dragged)
  const out = new Map<string, Follower[]>()
  const follow = (leader: string, id: string) => {
    const from = space.elements[leader]
    const member = space.elements[id]
    if (!from || !member || moving.has(id)) return
    moving.add(id)
    out.set(leader, [
      ...(out.get(leader) ?? []),
      { id, dx: member.x - from.x, dy: member.y - from.y },
    ])
  }
  for (const leader of dragged) for (const id of groupOf(leader)) follow(leader, id)
  // A Set visits what is added while it is walked: a frame that joined as a follower is asked
  // for its contents in turn.
  for (const leader of moving) {
    const owner = dragged.includes(leader) ? leader : leaderOf(out, leader)
    if (registry.get(space.elements[leader]?.type ?? '')?.container)
      for (const id of membersOf(space, leader, registry)) follow(owner, id)
  }
  return out
}

function leaderOf(followers: Map<string, Follower[]>, id: string): string {
  for (const [leader, list] of followers)
    if (list.some((follower) => follower.id === id)) return leader
  return id
}
