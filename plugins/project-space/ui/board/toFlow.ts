import type { CanvasEdgeType, Node } from '@localixai/kit/canvas'
import type { SpaceView } from '../../shared/api'
import type { SpaceEdge, SpaceElement } from '../../shared/format/document'
import { byOrder } from '../../shared/format/order'
import type { PropsRead, TypeRegistry } from '../../shared/registry/registry'

/**
 * The board as the flow library draws it: one node type for every element (the node looks its
 * view up by type), one floating connector per edge.
 *
 * Frames are a layer below everything else, largest first, so a note dropped into a frame is
 * never hidden behind it whatever their stacking keys say; within a layer the keys decide, and
 * `shared/ops/stacking.ts` steps an element only among its own layer for that reason. Nodes
 * are flat — a frame is not a React Flow parent — because membership is geometry
 * (`shared/ops/geometry.ts`), not a tree the library would have to keep in step.
 */
export const ELEMENT_NODE = 'space-element'

/** The board's route names as the host edge spells them. */
const ROUTE = { curved: 'bezier', straight: 'straight', elbow: 'step' } as const

export interface ElementNodeData extends Record<string, unknown> {
  element: SpaceElement
  read: PropsRead
  missing: boolean
  stamp: number
}

export type ElementNode = Node<ElementNodeData>

/**
 * The nodes and connectors of the last conversion, by id, with what each was made from. A node
 * whose element (the same object — `useSpace` keeps unchanged elements), stacking, file state
 * and type version are what they were is handed back as the SAME node: the library re-renders
 * only nodes that are new objects, so a poll or an edit of one note redraws one note.
 */
export interface FlowCache {
  nodes: Map<string, { key: readonly unknown[]; node: ElementNode }>
  edges: Map<string, { key: readonly unknown[]; edge: CanvasEdgeType }>
}

export const flowCache = (): FlowCache => ({ nodes: new Map(), edges: new Map() })

const sameKey = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

export function toFlow(view: SpaceView, registry: TypeRegistry, cache: FlowCache = flowCache()) {
  const missing = new Set(view.missing)
  const all = Object.entries(view.space.elements).map(([id, element]) => ({ id, ...element }))
  const container = (element: SpaceElement) => registry.get(element.type)?.container === true
  const frames = all.filter(container).sort((a, b) => b.w * b.h - a.w * a.h || byOrder(a, b))
  const rest = all.filter((element) => !container(element)).sort(byOrder)

  const node = ({ id }: { id: string }, zIndex: number): ElementNode => {
    const element = view.space.elements[id] as SpaceElement
    const key = [
      element,
      zIndex,
      missing.has(id),
      view.stamps[id] ?? 0,
      view.space.typeVersions[element.type],
    ]
    const cached = cache.nodes.get(id)
    if (cached && sameKey(cached.key, key)) return cached.node
    const made = build(id, element, zIndex)
    cache.nodes.set(id, { key, node: made })
    return made
  }
  const build = (id: string, element: SpaceElement, zIndex: number): ElementNode => ({
    id,
    type: ELEMENT_NODE,
    position: { x: element.x, y: element.y },
    width: element.w,
    height: element.h,
    // The size IS the element's: the node box is drawn at w×h, so the measure is known without
    // asking the DOM. The library's resizer starts from `measured` (0×0 when absent), and an
    // aspect-locked image then divided 0 by 0 and wrote NaN — `null` in JSON — as its size.
    measured: { width: element.w, height: element.h },
    zIndex,
    // A locked element is scenery: the pointer passes through it to the ground,
    // so a drag-select starts on a locked background picture instead of being swallowed by it.
    // Its badge still takes a click, to unlock it; the layers panel lists it too.
    draggable: !element.locked,
    selectable: !element.locked,
    connectable: !element.locked,
    ...(element.locked ? { className: 'space-locked' } : {}),
    data: {
      element,
      read: registry.read(element.type, element.props, view.space.typeVersions[element.type]),
      missing: missing.has(id),
      stamp: view.stamps[id] ?? 0,
    },
  })
  const nodes = [
    ...frames.map((frame, index) => node(frame, index)),
    ...rest.map((element) => node(element, 1000)),
  ]

  for (const id of cache.nodes.keys()) if (!view.space.elements[id]) cache.nodes.delete(id)

  const edges: CanvasEdgeType[] = Object.entries(view.space.edges)
    .filter(([, edge]) => view.space.elements[edge.from] && view.space.elements[edge.to])
    .map(([id, edge]) => {
      const cached = cache.edges.get(id)
      if (cached?.key[0] === edge) return cached.edge
      const made = buildEdge(id, edge)
      cache.edges.set(id, { key: [edge], edge: made })
      return made
    })
  for (const id of cache.edges.keys()) if (!view.space.edges[id]) cache.edges.delete(id)
  return { nodes, edges }
}

/** Stroke widths in board pixels; a cap grows with its line. */
const EDGE_WEIGHT = { thin: 1.25, regular: 1.75, bold: 2.75 } as const

function buildEdge(id: string, edge: SpaceEdge): CanvasEdgeType {
  return {
    id,
    source: edge.from,
    target: edge.to,
    zIndex: 500,
    data: {
      float: true,
      ...(edge.fromSide ? { fromSide: edge.fromSide } : {}),
      ...(edge.toSide ? { toSide: edge.toSide } : {}),
      route: ROUTE[edge.route ?? 'curved'],
      startCap: edge.start ?? 'none',
      endCap: edge.end ?? 'triangle',
      stroke: edge.stroke ?? 'solid',
      weight: EDGE_WEIGHT[edge.weight ?? 'regular'],
      labelAlways: true,
      caption: true,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.labelAt !== undefined ? { labelAt: edge.labelAt } : {}),
      toneClass: `space-tone-${edge.color ?? 'gray'} space-ink`,
    },
  }
}
