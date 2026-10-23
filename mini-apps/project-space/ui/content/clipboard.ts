import type { SpaceDocument, SpaceEdge, SpaceElement } from '../../shared/format/document'
import { newId, takenIn } from '../../shared/format/ids'
import { byOrder } from '../../shared/format/order'
import type { SpaceOp } from '../../shared/ops/contract'
import { membersOf } from '../../shared/ops/geometry'
import { spaceTypes } from '../../shared/types'

/**
 * Copy and paste of board elements, Kinopio's way: the elements themselves are kept in memory,
 * and the system clipboard gets their TEXT — so a copy pasted into a chat or an editor is
 * readable, and a paste back onto a board recreates the elements only when the clipboard still
 * holds exactly what this copy put there. A custom clipboard type would not survive the webview's
 * clipboard everywhere; this needs nothing but plain text.
 *
 * A paste makes fresh ids, keeps only the connectors whose both ends were copied, and lands at the
 * pointer (or beside the originals). Duplicate is the same thing without the clipboard.
 */
interface Copied {
  text: string
  elements: (SpaceElement & { id: string })[]
  edges: (SpaceEdge & { id: string })[]
}

let copied: Copied | null = null

/** The selection, frames carrying what they hold. */
function collect(space: SpaceDocument, ids: readonly string[]) {
  const roots = ids.filter((id) => space.elements[id])
  const chosen = new Set(roots)
  for (const id of roots) for (const member of membersOf(space, id, spaceTypes)) chosen.add(member)
  const elements = [...chosen]
    .map((id) => ({ id, ...(space.elements[id] as SpaceElement) }))
    .sort(byOrder)
  const edges = Object.entries(space.edges)
    .filter(([, edge]) => chosen.has(edge.from) && chosen.has(edge.to))
    .map(([id, edge]) => ({ id, ...edge }))
  return { elements, edges }
}

export function copySelection(space: SpaceDocument, ids: readonly string[]): string | null {
  const { elements, edges } = collect(space, ids)
  if (elements.length === 0) return null
  const text = elements
    .map((element) => {
      const spec = spaceTypes.get(element.type)
      const read = spaceTypes.read(element.type, element.props, space.typeVersions[element.type])
      return spec && read.status === 'ok' ? spec.text(read.props) : ''
    })
    .filter(Boolean)
    .join('\n\n')
  copied = { text: text || `${elements.length} board elements`, elements, edges }
  return copied.text
}

/** The operations that paste the last copy, or null when the clipboard holds something else. */
export function pasteOps(
  space: SpaceDocument,
  clipboardText: string,
  at: { x: number; y: number } | null,
) {
  if (!copied || copied.text !== clipboardText) return null
  return recreate(space, copied, at)
}

export function duplicateOps(space: SpaceDocument, ids: readonly string[]): SpaceOp[] {
  const { elements, edges } = collect(space, ids)
  return recreate(space, { text: '', elements, edges }, null)
}

const OFFSET = 32

function recreate(
  space: SpaceDocument,
  source: Copied,
  at: { x: number; y: number } | null,
): SpaceOp[] {
  const left = Math.min(...source.elements.map((element) => element.x))
  const top = Math.min(...source.elements.map((element) => element.y))
  const dx = at ? at.x - left : OFFSET
  const dy = at ? at.y - top : OFFSET
  const fresh = new Set<string>()
  const onBoard = takenIn(space)
  const taken = (id: string) => fresh.has(id) || onBoard(id)
  const ids = new Map<string, string>()
  const ops: SpaceOp[] = []
  for (const { id, type, x, y, w, h, props, locked, opacity } of source.elements) {
    const next = newId(taken)
    fresh.add(next)
    ids.set(id, next)
    ops.push({
      op: 'create',
      type,
      id: next,
      x: x + dx,
      y: y + dy,
      w,
      h,
      props,
      ...(locked ? { locked } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
    })
  }
  for (const { id: _id, from, to, ...style } of source.edges) {
    ops.push({ op: 'connect', from: ids.get(from) as string, to: ids.get(to) as string, ...style })
  }
  ops.push(...regroup(source.elements, ids))
  return ops
}

/**
 * The copies' groups, as the originals' but under new ids: a group op per group with two or more
 * copied members, innermost first, so grouping appends each id outside the last and the nesting
 * comes out the same. A group only partly copied is no group among the copies.
 */
function regroup(elements: Copied['elements'], ids: Map<string, string>): SpaceOp[] {
  const depth = new Map<string, number>()
  const members = new Map<string, string[]>()
  for (const element of elements)
    (element.groups ?? []).forEach((group, index) => {
      depth.set(group, Math.max(depth.get(group) ?? 0, index))
      members.set(group, [...(members.get(group) ?? []), ids.get(element.id) as string])
    })
  return [...members]
    .filter(([, of]) => of.length >= 2)
    .sort(([a], [b]) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0))
    .map(([, of]) => ({ op: 'group', ids: of }))
}
