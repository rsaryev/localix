import type { SpaceDocument, SpaceEdge } from '../../shared/format/document'
import type { AlignEdge, Axis, SpaceOp, Stacking } from '../../shared/ops/contract'
import { readingOrder } from '../../shared/ops/layout'
import { selectedGroups } from './selection'

/**
 * What a person can do to a selection, as the operations it writes — one answer, asked by the
 * selection bar, the keys and the layers panel alike, so a shortcut and a button can never do
 * two different things. Each returns null when it does not apply, which is also how a button
 * knows to hide.
 */
export interface Selected {
  space: SpaceDocument
  /** The selected ELEMENTS (connectors are not stacked, grouped or aligned). */
  ids: readonly string[]
  entered: string | null
}

const unlocked = ({ space, ids }: Selected) => ids.filter((id) => !space.elements[id]?.locked)

export function groupOps(selection: Selected): SpaceOp[] | null {
  const groups = selectedGroups(selection.space, new Set(selection.ids), selection.entered)
  // A selection that is exactly one group is grouped already.
  if (selection.ids.length < 2) return null
  if (groups.size === 1 && [...groups.values()][0]?.length === selection.ids.length) return null
  return [{ op: 'group', ids: [...selection.ids] }]
}

export function ungroupOps(selection: Selected): SpaceOp[] | null {
  const groups = selectedGroups(selection.space, new Set(selection.ids), selection.entered)
  return groups.size ? [...groups.keys()].map((id) => ({ op: 'ungroup', id })) : null
}

export function stackOps(selection: Selected, to: Stacking): SpaceOp[] | null {
  return selection.ids.length ? [{ op: 'order', ids: [...selection.ids], to }] : null
}

export function alignOps(selection: Selected, edge: AlignEdge): SpaceOp[] | null {
  return unlocked(selection).length >= 2 ? [{ op: 'align', ids: [...selection.ids], edge }] : null
}

export function distributeOps(selection: Selected, axis: Axis): SpaceOp[] | null {
  return unlocked(selection).length >= 3
    ? [{ op: 'distribute', ids: [...selection.ids], axis }]
    : null
}

/** Tidy up: the selection laid out as a grid in reading order from where it starts. */
export function tidyOps(selection: Selected): SpaceOp[] | null {
  const ids = unlocked(selection)
  if (ids.length < 2) return null
  const elements = selection.space.elements
  const reading = [...ids].sort((a, b) => readingOrder(elements[a]!, elements[b]!))
  return [{ op: 'arrange', ids: reading, layout: 'grid' }]
}

export function lockOps(selection: Selected): SpaceOp[] | null {
  if (!selection.ids.length) return null
  const locked = selection.ids.every((id) => selection.space.elements[id]?.locked)
  return selection.ids.map((id) => ({ op: 'update', id, locked: !locked }))
}

/** A connector turned around: its caps swap ends, its ends stay (`shared/graph/links.ts` reads it). */
export function reverseEdgeOps(id: string, edge: SpaceEdge): SpaceOp[] {
  return [{ op: 'edge', id, start: edge.end ?? 'triangle', end: edge.start ?? 'none' }]
}

export function opacityOps(selection: Selected, opacity: number): SpaceOp[] | null {
  return selection.ids.length
    ? unlocked(selection).map((id) => ({ op: 'update', id, opacity }))
    : null
}
