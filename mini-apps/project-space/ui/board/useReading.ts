import { useCallback, useMemo, useRef, useState } from 'react'
import type { CanvasEdgeType } from '@localixai/kit/canvas'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SpaceDocument } from '../../shared/format/document'
import { linksOf } from '../../shared/graph/links'
import { neighbourhood, reach, type Reading, type ReachDirection } from '../../shared/graph/reach'
import type { ElementNode } from './toFlow'

/**
 * How the board helps the person READ its graph, on top of how it is drawn.
 *
 * A board of forty cards used to answer "what is this joined to?" only by following every line
 * with the eye. Two readings now answer it, and both come from drawn connectors only
 * (`shared/graph/reach.ts`):
 *
 * - NEAR — one element selected: its connectors light up. Nothing else changes, because a click
 *   is also how a person starts to edit, and a board that dimmed on every click would fight them.
 * - TRACE — asked for (the element's connections menu, its context menu): everything upstream or
 *   downstream of it stays lit and the rest recedes, until Escape or the chip's close. It outlives
 *   the selection on purpose: the person clicks through what the trace found.
 *
 * Only one trace at a time, and it ends by itself when its origin leaves the board.
 */
export interface Trace {
  origin: string
  direction: ReachDirection
}

export interface BoardReading {
  trace: Trace | null
  /** What is lit now: the trace, else the one selected element's neighbourhood, else nothing. */
  lit: (Reading & { kind: 'trace' | 'near' }) | null
  toggleTrace: (origin: string, direction: ReachDirection) => void
  clearTrace: () => boolean
  links: ReturnType<typeof linksOf>
}

export function useReading(
  space: SpaceDocument,
  selected: ReadonlySet<string>,
  /** A trace has started: the elements it lit, for the camera to bring into view. */
  onTrace: (ids: readonly string[]) => void,
): BoardReading {
  const [asked, setTrace] = useState<Trace | null>(null)
  const trace = asked && space.elements[asked.origin] ? asked : null
  const links = useMemo(() => linksOf(space), [space])
  const now = useRef({ space, links, trace, onTrace })
  now.current = { space, links, trace, onTrace }
  const single = selected.size === 1 ? [...selected][0] : undefined
  const near = single && space.elements[single] ? single : undefined
  const lit = useMemo(() => {
    if (trace)
      return { kind: 'trace' as const, ...reach(space, trace.origin, trace.direction, links) }
    if (near) return { kind: 'near' as const, ...neighbourhood(space, near, links) }
    return null
  }, [links, near, space, trace])
  const toggleTrace = useCallback((origin: string, direction: ReachDirection) => {
    const { space: board, links: joined, trace: current, onTrace: show } = now.current
    if (current?.origin === origin && current.direction === direction) return setTrace(null)
    setTrace({ origin, direction })
    show([...reach(board, origin, direction, joined).elements.keys()])
  }, [])
  const clearTrace = () => {
    if (!trace) return false
    setTrace(null)
    return true
  }
  return { trace, lit, toggleTrace, clearTrace, links }
}

/**
 * The reading's mark on one element and one connector: a lit connector is the kit edge's `focus`,
 * one outside a trace `dimmed`; an element outside a trace recedes. NEAR dims nothing.
 */
export function readingMarks(lit: BoardReading['lit']) {
  const tracing = lit?.kind === 'trace'
  return {
    dims: (id: string) => tracing && !lit.elements.has(id),
    edge: (id: string): 'focus' | 'dimmed' | null =>
      lit?.edges.has(id) ? 'focus' : tracing ? 'dimmed' : null,
  }
}

/**
 * The drawn nodes and connectors with the reading applied (`readingMarks`). Each is handed back
 * as the SAME object while its state is what it was, so a trace redraws what it changes and a
 * poll of the board redraws nothing (`toFlow.ts` says why that matters). Weak keys avoid keeping
 * deleted cards and old content alive after a trace or a board edit.
 */
export function useReadingFlow(
  nodes: readonly ElementNode[],
  edges: readonly CanvasEdgeType[],
  lit: BoardReading['lit'],
) {
  const nodeCache = useRef(new WeakMap<ElementNode, { dim: boolean; node: ElementNode }>())
  const edgeCache = useRef(new WeakMap<CanvasEdgeType, { mark: string; edge: CanvasEdgeType }>())
  const marks = useMemo(() => readingMarks(lit), [lit])
  const shownNodes = useMemo(
    () =>
      nodes.map((node) => {
        const dim = marks.dims(node.id)
        if (!dim) return node
        const cached = nodeCache.current.get(node)
        if (cached?.dim === dim) return cached.node
        const next = { ...node, className: cn(node.className, 'space-dimmed') }
        nodeCache.current.set(node, { dim, node: next })
        return next
      }),
    [marks, nodes],
  )
  const shownEdges = useMemo(
    () =>
      edges.map((edge) => {
        const mark = marks.edge(edge.id)
        if (!mark) return edge
        const cached = edgeCache.current.get(edge)
        if (cached?.mark === mark) return cached.edge
        const next: CanvasEdgeType = { ...edge, data: { ...edge.data, emphasis: mark } }
        edgeCache.current.set(edge, { mark, edge: next })
        return next
      }),
    [edges, marks],
  )
  return { nodes: shownNodes, edges: shownEdges }
}
