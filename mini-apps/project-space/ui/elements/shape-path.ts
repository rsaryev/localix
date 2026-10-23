import type { SHAPE_KINDS } from '../../shared/types/drawing'

/**
 * Each shape kind's outline as one SVG path for a `w`×`h` box, inset by half the stroke so the
 * line is never clipped at the box edge. One path per kind (not per-kind SVG elements) is what
 * lets the view draw every kind with the same fill, stroke and dash classes.
 */
export type ShapeKind = (typeof SHAPE_KINDS)[number]

export function shapePath(kind: ShapeKind, w: number, h: number, inset = 1): string {
  const l = inset
  const t = inset
  const r = w - inset
  const b = h - inset
  const cx = w / 2
  const cy = h / 2
  const p = (...points: [number, number][]) =>
    `M ${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(' L ')} Z`
  switch (kind) {
    case 'rectangle':
      return p([l, t], [r, t], [r, b], [l, b])
    case 'rounded': {
      const k = Math.min(14, (r - l) / 4, (b - t) / 4)
      return `M ${l + k} ${t} H ${r - k} Q ${r} ${t} ${r} ${t + k} V ${b - k} Q ${r} ${b} ${r - k} ${b} H ${l + k} Q ${l} ${b} ${l} ${b - k} V ${t + k} Q ${l} ${t} ${l + k} ${t} Z`
    }
    case 'ellipse': {
      const rx = (r - l) / 2
      const ry = (b - t) / 2
      return `M ${l} ${cy} A ${rx} ${ry} 0 1 0 ${r} ${cy} A ${rx} ${ry} 0 1 0 ${l} ${cy} Z`
    }
    case 'diamond':
      return p([cx, t], [r, cy], [cx, b], [l, cy])
    case 'triangle':
      return p([cx, t], [r, b], [l, b])
    case 'hexagon': {
      const k = Math.min((r - l) / 4, (b - t) / 2)
      return p([l + k, t], [r - k, t], [r, cy], [r - k, b], [l + k, b], [l, cy])
    }
    case 'parallelogram': {
      const k = Math.min((r - l) / 5, 28)
      return p([l + k, t], [r, t], [r - k, b], [l, b])
    }
    case 'cylinder': {
      const ry = Math.min(14, (b - t) / 6)
      const rx = (r - l) / 2
      // The top rim is a full ellipse; the body closes with the lower half of the bottom one.
      return `M ${l} ${t + ry} A ${rx} ${ry} 0 1 0 ${r} ${t + ry} A ${rx} ${ry} 0 1 0 ${l} ${t + ry} V ${b - ry} A ${rx} ${ry} 0 0 0 ${r} ${b - ry} V ${t + ry}`
    }
    case 'document': {
      const wave = Math.min(12, (b - t) / 6)
      return `M ${l} ${t} H ${r} V ${b - wave} Q ${l + (r - l) * 0.75} ${b - wave * 3} ${cx} ${b - wave} T ${l} ${b - wave} Z`
    }
    case 'cloud': {
      // One outer silhouette: overlapping ellipses left internal rings across the label.
      const point = (x: number, y: number) => `${round(l + x * (r - l))} ${round(t + y * (b - t))}`
      return [
        `M ${point(0.25, 0.86)}`,
        `C ${point(0.11, 0.86)} ${point(0, 0.73)} ${point(0, 0.56)}`,
        `C ${point(0, 0.41)} ${point(0.09, 0.29)} ${point(0.21, 0.28)}`,
        `C ${point(0.2, 0.12)} ${point(0.35, 0)} ${point(0.49, 0)}`,
        `C ${point(0.65, 0)} ${point(0.78, 0.13)} ${point(0.78, 0.29)}`,
        `C ${point(0.9, 0.28)} ${point(1, 0.4)} ${point(1, 0.56)}`,
        `C ${point(1, 0.74)} ${point(0.86, 0.86)} ${point(0.72, 0.86)}`,
        `C ${point(0.63, 1)} ${point(0.37, 1)} ${point(0.25, 0.86)} Z`,
      ].join(' ')
    }
    case 'star': {
      const points: [number, number][] = []
      for (let index = 0; index < 10; index++) {
        const angle = -Math.PI / 2 + (index * Math.PI) / 5
        const radius = index % 2 === 0 ? 1 : 0.45
        points.push([
          cx + (Math.cos(angle) * radius * (r - l)) / 2,
          cy + (Math.sin(angle) * radius * (b - t)) / 2,
        ])
      }
      return p(...points)
    }
  }
}

/** Where a shape's label may go: the inner box that stays inside the outline. */
export function labelInset(kind: ShapeKind): { x: number; y: number } {
  if (kind === 'diamond' || kind === 'star' || kind === 'triangle') return { x: 0.22, y: 0.22 }
  if (kind === 'ellipse' || kind === 'cloud') return { x: 0.14, y: 0.14 }
  if (kind === 'cylinder') return { x: 0.06, y: 0.2 }
  return { x: 0.06, y: 0.08 }
}

const round = (value: number) => Math.round(value * 10) / 10
