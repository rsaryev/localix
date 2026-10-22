import { z } from 'zod'
import type { ElementTypeSpec } from '../registry/contract'
import { colorSchema } from '../format/schema'

export interface PenPoint {
  x: number
  y: number
}
export const PEN_WIDTH = { s: 1.5, m: 3, l: 5, xl: 8 } as const
export const PEN_POINTS = 4096
/** A pen line, or a highlighter's wide, translucent stroke over what it marks. */
export const PEN_KINDS = ['pen', 'highlighter'] as const
const props = z.object({
  kind: z.enum(PEN_KINDS).default('pen'),
  color: colorSchema.default('blue'),
  size: z.enum(['s', 'm', 'l', 'xl']).default('m'),
  canvas: z
    .object({ w: z.number().finite().positive(), h: z.number().finite().positive() })
    .default({ w: 160, h: 80 }),
  points: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
    .min(1)
    .max(PEN_POINTS)
    .default([
      { x: 8, y: 60 },
      { x: 50, y: 20 },
      { x: 100, y: 60 },
      { x: 152, y: 20 },
    ]),
})
export type PenProps = z.infer<typeof props>
export const penType: ElementTypeSpec<PenProps> = {
  type: 'pen',
  version: 1,
  label: 'Pen',
  description:
    'A native freehand stroke. props: points [{x,y}] in local canvas coordinates, canvas {w,h}, color, size s|m|l|xl, kind pen|highlighter (a wide translucent mark). Draw with a pointer; each stroke is one element and one undo step. Resize, recolour, duplicate or delete like other elements.',
  props,
  size: { w: 160, h: 80 },
  minSize: { w: 8, h: 8 },
  text: () => 'Freehand drawing',
}

/** Smooth midpoint quadratics; two points stay a straight line and one point stays a dot. */
export function penPath(points: readonly PenPoint[]): string {
  const first = points[0]
  if (!first) return ''
  let path = `M ${first.x} ${first.y}`
  for (let at = 1; at < points.length - 1; at++) {
    const point = points[at]!,
      next = points[at + 1]!
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  }
  const last = points.at(-1)!
  return `${path} L ${last.x} ${last.y}`
}

/** Bounds include the widest stroke so a resized drawing never clips at its edge. */
export function penElement(points: readonly PenPoint[]) {
  const pad = 5
  const x = Math.floor(Math.min(...points.map((point) => point.x)) - pad)
  const y = Math.floor(Math.min(...points.map((point) => point.y)) - pad)
  const w = Math.ceil(Math.max(...points.map((point) => point.x)) - x + pad)
  const h = Math.ceil(Math.max(...points.map((point) => point.y)) - y + pad)
  return {
    x,
    y,
    w,
    h,
    props: {
      canvas: { w, h },
      points: points.map((point) => ({ x: point.x - x, y: point.y - y })),
    },
  }
}

/** A highlighter's stroke is this much wider than a pen's of the same size. */
export const HIGHLIGHTER_SCALE = 3.5

/**
 * The freehand strokes an eraser's path passes over: any point of a stroke within `radius` of the
 * eraser (and half the stroke's own width) is hit. Only strokes — an eraser never takes a note.
 */
export function strokesHit(
  elements: Iterable<
    [
      string,
      {
        type: string
        x: number
        y: number
        w: number
        h: number
        locked?: boolean
        props?: Record<string, unknown>
      },
    ]
  >,
  path: readonly PenPoint[],
  radius: number,
): string[] {
  const hit: string[] = []
  for (const [id, element] of elements) {
    if (element.type !== 'pen' || element.locked || path.length === 0) continue
    const read = props.safeParse(element.props ?? {})
    if (!read.success) continue
    const { canvas, points, size, kind } = read.data
    const reach = radius + (PEN_WIDTH[size] * (kind === 'highlighter' ? HIGHLIGHTER_SCALE : 1)) / 2
    const sx = element.w / canvas.w
    const sy = element.h / canvas.h
    // Outside the stroke's box widened by the reach, no point of it can be hit.
    const outside = path.every(
      (at) =>
        at.x < element.x - reach ||
        at.x > element.x + element.w + reach ||
        at.y < element.y - reach ||
        at.y > element.y + element.h + reach,
    )
    if (outside) continue
    // Distance to each SEGMENT of the stroke: a straight line has two points, both far from
    // an eraser crossing its middle.
    const board = points.map((point) => ({
      x: element.x + point.x * sx,
      y: element.y + point.y * sy,
    }))
    const touched = path.some((at) =>
      board.length === 1
        ? Math.hypot(at.x - board[0]!.x, at.y - board[0]!.y) <= reach
        : board.slice(1).some((to, index) => toSegment(at, board[index]!, to) <= reach),
    )
    if (touched) hit.push(id)
  }
  return hit
}

/** The distance from a point to the segment a–b. */
function toSegment(point: PenPoint, a: PenPoint, b: PenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}
