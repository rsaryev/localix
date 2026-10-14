import { z } from 'zod'
import type { ElementTypeSpec } from '../registry/contract'
import { colorSchema } from '../format/schema'

export interface PenPoint {
  x: number
  y: number
}
export const PEN_WIDTH = { s: 1.5, m: 3, l: 5, xl: 8 } as const
export const PEN_POINTS = 4096
const props = z.object({
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
    'A native freehand stroke. props: points [{x,y}] in local canvas coordinates, canvas {w,h}, color, size s|m|l|xl. Draw with a pointer; each stroke is one element and one undo step. Resize, recolour, duplicate or delete like other elements.',
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
