import type { SpaceDocument, SpaceEdge } from '../format/document'

/**
 * Which way a connector runs, and what an element is joined to — the board's graph as the person
 * SEES it.
 *
 * Direction is read from the caps, not from `from`/`to`: the connector bar's "Reverse" swaps the
 * caps and keeps the ends, so a connector drawn A → B and reversed is stored `from: A` with its
 * head at A. Reading `from`/`to` would trace "downstream" against the arrow on the screen. A cap is
 * a head when it is anything but `none` — the rule the agent's roster already draws its arrows by
 * (`agent/describe.ts`), so the person and the agent never disagree about which way a line points.
 * A line with a head at both ends, or at neither, joins both ways.
 */
export type Direction = 'forward' | 'backward' | 'both'

/** The end cap a connector has when the file names none: the board draws a triangle. */
const DEFAULT_END = 'triangle'

export function directionOf(edge: Pick<SpaceEdge, 'start' | 'end'>): Direction {
  const head = (edge.end ?? DEFAULT_END) !== 'none'
  const tail = (edge.start ?? 'none') !== 'none'
  return head === tail ? 'both' : head ? 'forward' : 'backward'
}

/** The arrow the roster prints for a connector. */
export function arrowOf(edge: Pick<SpaceEdge, 'start' | 'end'>): '→' | '←' | '↔' | '—' {
  const head = (edge.end ?? DEFAULT_END) !== 'none'
  const tail = (edge.start ?? 'none') !== 'none'
  return head && tail ? '↔' : head ? '→' : tail ? '←' : '—'
}

/** One connector seen from one of its ends. */
export interface Link {
  edge: string
  /** The element at the other end. */
  other: string
  /** `out`: the line points away from this element; `in`: at it; `both`: either way. */
  way: 'out' | 'in' | 'both'
  label?: string
}

/**
 * Every element's connectors, by element, in the file's order. A connector whose other end is not
 * on the board (the reader keeps such a record undrawn) joins nothing.
 */
export function linksOf(space: SpaceDocument): Map<string, Link[]> {
  const links = new Map<string, Link[]>()
  const add = (id: string, link: Link) => links.set(id, [...(links.get(id) ?? []), link])
  for (const [edge, record] of Object.entries(space.edges)) {
    if (!space.elements[record.from] || !space.elements[record.to]) continue
    if (record.from === record.to) continue
    const direction = directionOf(record)
    const label = record.label ? { label: record.label } : {}
    const fromWay = direction === 'both' ? 'both' : direction === 'forward' ? 'out' : 'in'
    const toWay = direction === 'both' ? 'both' : direction === 'forward' ? 'in' : 'out'
    add(record.from, { edge, other: record.to, way: fromWay, ...label })
    add(record.to, { edge, other: record.from, way: toWay, ...label })
  }
  return links
}
