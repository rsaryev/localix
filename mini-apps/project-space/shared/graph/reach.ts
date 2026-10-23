import type { SpaceDocument } from '../format/document'
import { linksOf, type Link } from './links'

/**
 * What a person asks of the board's graph: what one element touches, and what it leads to or
 * comes from along the arrows.
 *
 * Only DRAWN connectors count. Two notes that sit side by side, a file inside a frame, a label that
 * mentions another element: none of these is a relation, and a trace that inferred one would show
 * the person a structure nobody drew. This is authored reach, and it is deliberately never called
 * impact. A two-way connector is followed either way; a cycle is walked once.
 */
export type ReachDirection = 'upstream' | 'downstream'

export interface Reading {
  /** The elements lit, each with its distance in hops from the origin (the origin is 0). */
  elements: Map<string, number>
  edges: Set<string>
  /** The longest shortest path found, in hops. */
  hops: number
}

/** The element, the connectors touching it and the elements at their other ends. */
export function neighbourhood(space: SpaceDocument, id: string, links = linksOf(space)): Reading {
  const elements = new Map([[id, 0]])
  const edges = new Set<string>()
  for (const link of links.get(id) ?? []) {
    edges.add(link.edge)
    elements.set(link.other, 1)
  }
  return { elements, edges, hops: edges.size ? 1 : 0 }
}

/**
 * Breadth first from `id`: downstream follows the arrows out of each element, upstream the arrows
 * into it. Shortest distances, so an element two ways away is at its nearer depth.
 */
export function reach(
  space: SpaceDocument,
  id: string,
  direction: ReachDirection,
  links = linksOf(space),
): Reading {
  const follows = (link: Link) =>
    link.way === 'both' || link.way === (direction === 'downstream' ? 'out' : 'in')
  const elements = new Map([[id, 0]])
  const edges = new Set<string>()
  let frontier = [id]
  let hops = 0
  while (frontier.length) {
    const next: string[] = []
    for (const at of frontier)
      for (const link of links.get(at) ?? []) {
        if (!follows(link)) continue
        edges.add(link.edge)
        if (elements.has(link.other)) continue
        elements.set(link.other, hops + 1)
        next.push(link.other)
      }
    if (next.length) hops++
    frontier = next
  }
  return { elements, edges, hops }
}

/** How far each way reaches from `id`: the counts a person sees before choosing a direction. */
export function reachCounts(space: SpaceDocument, id: string, links = linksOf(space)) {
  return {
    upstream: reach(space, id, 'upstream', links).elements.size - 1,
    downstream: reach(space, id, 'downstream', links).elements.size - 1,
  }
}
