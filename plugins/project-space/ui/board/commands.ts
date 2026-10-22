import type { SpaceDocument, SpaceEdge } from '../../shared/format/document'
import type { AlignEdge, Axis, SpaceOp, Stacking } from '../../shared/ops/contract'
import { newId, takenIn } from '../../shared/format/ids'
import { boundsOfBoxes, readingOrder } from '../../shared/ops/layout'
import { spaceTypes } from '../../shared/types'
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

/**
 * A shape put INTO a connector, as the design tools do: the connector becomes two, through a new
 * step at its middle, each half keeping the line's look and the label staying on the first. The
 * new step is a twin of the connector's source when that is a shape — a flow of decisions gets
 * another decision's colour — and a plain step otherwise.
 */
export function insertOnEdgeOps(
  space: SpaceDocument,
  id: string,
  random: () => number = Math.random,
): { ops: SpaceOp[]; created: string } | null {
  const edge = space.edges[id]
  const from = edge && space.elements[edge.from]
  const to = edge && space.elements[edge.to]
  if (!edge || !from || !to) return null
  const taken = takenIn(space)
  const created = newId(taken, random)
  const second = newId((candidate) => taken(candidate) || candidate === created, random)
  const size = { w: 160, h: 96 }
  const mid = {
    x: (from.x + from.w / 2 + to.x + to.w / 2) / 2,
    y: (from.y + from.h / 2 + to.y + to.h / 2) / 2,
  }
  const twin = from.type === 'shape' ? { color: from.props.color, fill: from.props.fill } : {}
  const { from: _from, to: _to, fromSide, toSide, label, labelAt: _at, ...look } = edge
  return {
    created,
    ops: [
      {
        op: 'create',
        id: created,
        type: 'shape',
        x: Math.round(mid.x - size.w / 2),
        y: Math.round(mid.y - size.h / 2),
        ...size,
        props: { kind: 'rounded', ...twin },
      },
      { op: 'delete', id },
      {
        op: 'connect',
        id,
        from: edge.from,
        to: created,
        ...(fromSide ? { fromSide } : {}),
        ...(label ? { label } : {}),
        ...look,
      },
      {
        op: 'connect',
        id: second,
        from: created,
        to: edge.to,
        ...(toSide ? { toSide } : {}),
        ...look,
      },
    ] as SpaceOp[],
  }
}

/** The room a frame made around a selection leaves on every side (its title sits above it). */
const FRAME_PAD = 40

/**
 * A frame drawn around the selection, as the design tools' "frame selection": what it covers it
 * holds, because membership is where things are. The id is chosen here so the caller can name the
 * frame right away (select it, edit its title).
 */
export function frameAroundOps(
  selection: Selected,
  random: () => number = Math.random,
): { ops: SpaceOp[]; id: string } | null {
  const boxes = selection.ids.flatMap((id) => {
    const element = selection.space.elements[id]
    return element ? [element] : []
  })
  if (boxes.length === 0) return null
  const box = boundsOfBoxes(boxes)
  const id = newId(takenIn(selection.space), random)
  return {
    id,
    ops: [
      {
        op: 'create',
        id,
        type: 'frame',
        x: Math.round(box.x - FRAME_PAD),
        y: Math.round(box.y - FRAME_PAD),
        w: Math.round(box.w + FRAME_PAD * 2),
        h: Math.round(box.h + FRAME_PAD * 2),
        text: 'Frame',
      },
    ],
  }
}

/**
 * How an element looks, apart from what it says and what it is: the props "copy style" takes and
 * "paste style" gives. A shape's kind is what it IS, so it stays.
 */
export const STYLE_PROPS = [
  'color',
  'fill',
  'stroke',
  'size',
  'font',
  'align',
  'valign',
  'ink',
] as const
export type CopiedStyle = Partial<Record<(typeof STYLE_PROPS)[number], unknown>>

export function styleOf(space: SpaceDocument, id: string): CopiedStyle | null {
  const element = space.elements[id]
  if (!element) return null
  const read = spaceTypes.read(element.type, element.props, space.typeVersions[element.type])
  if (read.status !== 'ok') return null
  const style = Object.fromEntries(
    STYLE_PROPS.flatMap((prop) =>
      read.props[prop] !== undefined ? [[prop, read.props[prop]]] : [],
    ),
  )
  return Object.keys(style).length ? style : null
}

/**
 * The copied style given to each selected element, prop by prop, only where its type takes that
 * value: a note's colour reaches a shape, a note's `auto` size does not (a shape has no such
 * size), and a frame takes only a colour.
 */
export function pasteStyleOps(selection: Selected, style: CopiedStyle): SpaceOp[] | null {
  const ops = unlocked(selection).flatMap((id): SpaceOp[] => {
    const element = selection.space.elements[id]
    if (!element) return []
    const version = selection.space.typeVersions[element.type]
    const props: Record<string, unknown> = {}
    for (const [prop, value] of Object.entries(style)) {
      const tried = { ...element.props, ...props, [prop]: value }
      const read = spaceTypes.read(element.type, tried, version)
      if (read.status === 'ok' && read.props[prop] === value) props[prop] = value
    }
    return Object.keys(props).length ? [{ op: 'update', id, props }] : []
  })
  return ops.length ? ops : null
}
