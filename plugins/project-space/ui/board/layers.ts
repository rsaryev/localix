import type { SpaceDocument, SpaceElement } from '../../shared/format/document'
import { byOrder } from '../../shared/format/order'
import { frameOf } from '../../shared/ops/geometry'
import { groupsOf } from '../../shared/ops/groups'
import type { TypeRegistry } from '../../shared/registry/registry'

/**
 * The layers panel's rows: the board as a tree of frames, each level listed TOP FIRST — the order the eye meets them. A level lists its elements
 * by stacking key, then its frames, because frames are always drawn beneath (`toFlow.ts`): a
 * list that put a frame above a note would claim a stacking the board never shows. Frames draw
 * largest-lowest, so within the frames the smaller comes first.
 */
export interface LayerRow {
  id: string
  depth: number
  element: SpaceElement
  container: boolean
  /** The element's outermost live group, for the row's group mark. */
  group: string | null
}

export function layerRows(space: SpaceDocument, registry: TypeRegistry): LayerRow[] {
  const container = (element: SpaceElement) => registry.get(element.type)?.container === true
  const children = new Map<string | null, string[]>()
  for (const id of Object.keys(space.elements)) {
    const parent = frameOf(space, id, registry)
    children.set(parent, [...(children.get(parent) ?? []), id])
  }
  const live = groupsOf(space)
  const rows: LayerRow[] = []
  const visit = (parent: string | null, depth: number) => {
    const level = (children.get(parent) ?? []).map((id) => ({ id, ...space.elements[id]! }))
    const top = level
      .filter((element) => !container(element))
      .sort(byOrder)
      .reverse()
    const frames = level.filter(container).sort((a, b) => a.w * a.h - b.w * b.h || byOrder(b, a))
    for (const { id, ...element } of [...top, ...frames]) {
      const group = (element.groups ?? []).findLast((candidate) => live.has(candidate)) ?? null
      rows.push({
        id,
        depth,
        element: element as SpaceElement,
        container: container(element),
        group,
      })
      if (container(element)) visit(id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}
