import type { FlowNode } from './flow-text'
import type { Point, Side } from './flow-route'

/**
 * A flowchart node's measure: its lines (a name wrapped to the widest node, then its sublabels),
 * the size its shape needs around them, and where a connector meets its outline. Estimated, not
 * measured, because the server sizes the element with no font to measure with.
 */
export const FLOW = {
  header: 32,
  pad: 24,
  node: { min: 104, max: 240, padX: 18, padY: 12, name: 18, sub: 16 },
  char: { name: 7.2, sub: 6.3, label: 6.2 },
  spacing: {
    narrow: { node: 28, rank: 44 },
    regular: { node: 48, rank: 64 },
    wide: { node: 80, rank: 100 },
  },
  group: { pad: 18, title: 22 },
  arrow: 7,
} as const

export interface FlowBox {
  x: number
  y: number
  w: number
  h: number
}

const round4 = (value: number) => Math.ceil(value / 4) * 4

/** A name wrapped to the node's widest line, then its sublabels as written. */
export function linesOf(node: FlowNode): string[] {
  const [name = '', ...subs] = node.label.split('\n')
  const room = Math.floor((FLOW.node.max - FLOW.node.padX * 2) / FLOW.char.name)
  const words = name.split(/\s+/u).filter(Boolean)
  const wrapped: string[] = []
  for (const word of words) {
    const last = wrapped.at(-1)
    if (last !== undefined && last.length + 1 + word.length <= room)
      wrapped[wrapped.length - 1] = `${last} ${word}`
    else wrapped.push(word)
  }
  return [...(wrapped.length ? wrapped : ['']), ...subs.map((sub) => sub.trim()).filter(Boolean)]
}

/** How many of a node's lines are its name (the rest are sublabels). */
export const nameLines = (node: FlowNode) =>
  linesOf({ ...node, label: node.label.split('\n')[0] ?? '' }).length

export function sizeOf(node: FlowNode, lines: string[]): { w: number; h: number } {
  const names = nameLines(node)
  const text = Math.max(
    ...lines.map((line, index) => line.length * (index < names ? FLOW.char.name : FLOW.char.sub)),
  )
  const w = Math.min(FLOW.node.max, Math.max(FLOW.node.min, text + FLOW.node.padX * 2))
  const h = FLOW.node.padY * 2 + names * FLOW.node.name + (lines.length - names) * FLOW.node.sub
  switch (node.shape) {
    case 'diamond':
      return { w: round4(Math.max(120, w * 1.45)), h: round4(Math.max(72, h * 1.6)) }
    case 'circle': {
      const d = round4(Math.max(72, Math.hypot(w, h) * 0.82))
      return { w: d, h: d }
    }
    case 'cylinder':
      return { w: round4(w), h: round4(h + 14) }
    case 'hexagon':
    case 'parallelogram':
      return { w: round4(w + 24), h: round4(h) }
    case 'stadium':
      return { w: round4(w + h * 0.4), h: round4(h) }
    case 'subroutine':
      return { w: round4(w + 16), h: round4(h) }
    case 'rect':
    case 'rounded':
      return { w: round4(w), h: round4(Math.max(44, h)) }
  }
}

/** The point on a node's outline at `offset` (−½…½ of the side) along `side`. */
export function anchor(node: FlowNode, box: FlowBox, side: Side, offset: number): Point {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const along = side === 'top' || side === 'bottom' ? box.w : box.h
  // A diamond's and a circle's sides are points: spread only a little, and land on the outline.
  const spread = node.shape === 'diamond' || node.shape === 'circle' ? 0.3 : 0.7
  const d = offset * along * spread
  const inset = (half: number, across: number) =>
    node.shape === 'diamond'
      ? half * (1 - Math.abs(d) / across)
      : node.shape === 'circle'
        ? Math.sqrt(Math.max(0, half * half - d * d))
        : half
  if (side === 'top') return { x: cx + d, y: cy - inset(box.h / 2, box.w / 2) }
  if (side === 'bottom') return { x: cx + d, y: cy + inset(box.h / 2, box.w / 2) }
  if (side === 'left') return { x: cx - inset(box.w / 2, box.h / 2), y: cy + d }
  return { x: cx + inset(box.w / 2, box.h / 2), y: cy + d }
}
