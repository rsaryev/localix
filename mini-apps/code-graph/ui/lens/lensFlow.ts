import type { CanvasEdgeEmphasis, CanvasEdgeType, Node } from '@localixai/kit/canvas'
import type { CodeCard, Lens } from '../../shared/lens'
import type { NodeSummaryView } from '../../shared/view'
import { BOX_TYPE, type GraphNodeData } from '../model/flow'
import type { CodeCardData } from './CodeCardNode'
import { cardSize, IN_HANDLE, lineHandle, lineY } from './geometry'

/**
 * The call lens as React Flow nodes: callers in a column on the left, the trail's cards left to
 * right, and the calls the LAST card makes that are not open yet as tiles on its right — each
 * level with the line that makes the call, so an edge runs straight from a line of code to what
 * it calls. Every edge between cards leaves from the line holding the link it followed.
 *
 * Positions derive from the lens alone, so a poll that brings the same trail changes nothing.
 */
export const CARD_TYPE = 'code-graph-card'

const TILE = { width: 200, height: 36, gap: 10 }
const GAP = 110

export interface LensHandlers {
  onFollow: (from: number, id: string) => void
  onPrepend: (id: string) => void
  onOpenFile: (card: CodeCard) => void
  onReveal: (fileId: string, symbolId: string) => void
}

type LensNode = Node<CodeCardData> | Node<GraphNodeData>

export interface LensFlow {
  nodes: LensNode[]
  edges: CanvasEdgeType[]
  /** The last card's frame, which the camera settles on. */
  focus: { x: number; y: number; width: number; height: number } | null
}

function tile(node: NodeSummaryView, x: number, y: number): Node<GraphNodeData> {
  return {
    id: node.id,
    type: BOX_TYPE,
    position: { x, y },
    width: TILE.width,
    height: TILE.height,
    data: { node: { ...node, role: 'child' }, emphasis: 'idle', highlighted: false },
    draggable: false,
    connectable: false,
    selectable: false,
    zIndex: 2,
  }
}

function edge(
  source: string,
  target: string,
  emphasis: CanvasEdgeEmphasis,
  sourceHandle?: string,
): CanvasEdgeType {
  return {
    id: `${source}\u0000${target}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    focusable: false,
    selectable: false,
    data: { emphasis, arrow: 'focus' },
    zIndex: 0,
  }
}

export function lensFlow(lens: Lens, handlers: LensHandlers): LensFlow {
  const nodes: LensNode[] = []
  const edges: CanvasEdgeType[] = []
  const cards = lens.trail
  const first = cards[0]
  if (!first) return { nodes, edges, focus: null }
  const onTrail = new Set(cards.map((card) => card.node.id))

  // Callers, centred on the first card's header.
  const callers = lens.callers.filter((caller) => !onTrail.has(caller.id))
  const column = callers.length * (TILE.height + TILE.gap) - TILE.gap
  callers.forEach((caller, row) => {
    nodes.push(tile(caller, 0, 20 - column / 2 + row * (TILE.height + TILE.gap)))
    edges.push(edge(caller.id, first.node.id, 'idle'))
  })

  let x = callers.length > 0 ? TILE.width + GAP : 0
  let focus: LensFlow['focus'] = null
  cards.forEach((card, index) => {
    const size = cardSize(card)
    const nextCard = cards[index + 1]
    nodes.push({
      id: card.node.id,
      type: CARD_TYPE,
      position: { x, y: 0 },
      width: size.width,
      height: size.height,
      data: {
        card,
        index,
        next: nextCard?.node.id ?? null,
        onFollow: handlers.onFollow,
        onOpenFile: handlers.onOpenFile,
        onReveal: handlers.onReveal,
      },
      draggable: false,
      connectable: false,
      selectable: false,
      zIndex: 2,
    })
    if (nextCard) {
      // The link that was followed — a call or any other name — is where the edge leaves from.
      const call = card.links.find((link) => link.target.id === nextCard.node.id)
      edges.push({
        ...edge(card.node.id, nextCard.node.id, 'focus', call ? lineHandle(call.line) : undefined),
        targetHandle: IN_HANDLE,
      })
    }
    focus = { x, y: 0, ...size }
    x += size.width + GAP
  })

  // What the last card calls and is not open yet, each opposite its first call line.
  const last = cards[cards.length - 1] as CodeCard
  let bottom = Number.NEGATIVE_INFINITY
  for (const callee of last.callees) {
    if (onTrail.has(callee.id)) continue
    const call = last.links.find((link) => link.kind === 'call' && link.target.id === callee.id)
    const y = Math.max(call ? lineY(last, call.line) - TILE.height / 2 : 0, bottom + TILE.gap)
    nodes.push(tile(callee, x, y))
    edges.push(edge(last.node.id, callee.id, 'idle', call ? lineHandle(call.line) : undefined))
    bottom = y + TILE.height
  }
  if (callers.length > 0)
    for (const e of edges) if (e.target === first.node.id) e.targetHandle = IN_HANDLE
  return { nodes, edges, focus }
}
