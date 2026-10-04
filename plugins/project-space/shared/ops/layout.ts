import type { AlignEdge, Axis, Layout } from './contract'
import type { Box } from './geometry'

/**
 * Where boxes go when they are lined up, spaced or laid out — pure geometry, one answer per
 * question, shared by the selection bar and the agent's `align` / `distribute` / `arrange`.
 *
 * A box here is a UNIT: an element, or a whole group or frame moved as one, so aligning a group
 * keeps its inside as it was. The answer is a shift per
 * unit, never a position, so the unit's members all move by it.
 */
export interface Unit extends Box {
  key: string
}

export type Shift = { dx: number; dy: number }

export function boundsOfBoxes(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.w))
  const bottom = Math.max(...boxes.map((box) => box.y + box.h))
  return { x, y, w: right - x, h: bottom - y }
}

/** Top to bottom, then left to right, with boxes on about the same line read as one row. */
export function readingOrder(a: Box, b: Box): number {
  const row = Math.min(a.h, b.h) / 2
  return Math.abs(a.y - b.y) > row ? a.y - b.y : a.x - b.x
}

/** Each unit onto one edge (or centre line) of the box around them all. */
export function alignUnits(units: readonly Unit[], edge: AlignEdge): Map<string, Shift> {
  const all = boundsOfBoxes(units)
  const target = (unit: Unit): Shift => {
    switch (edge) {
      case 'left':
        return { dx: all.x - unit.x, dy: 0 }
      case 'center':
        return { dx: all.x + all.w / 2 - (unit.x + unit.w / 2), dy: 0 }
      case 'right':
        return { dx: all.x + all.w - (unit.x + unit.w), dy: 0 }
      case 'top':
        return { dx: 0, dy: all.y - unit.y }
      case 'middle':
        return { dx: 0, dy: all.y + all.h / 2 - (unit.y + unit.h / 2) }
      case 'bottom':
        return { dx: 0, dy: all.y + all.h - (unit.y + unit.h) }
    }
  }
  return new Map(units.map((unit) => [unit.key, target(unit)]))
}

/**
 * Equal gaps between units along an axis, the first and last staying put. Units that overlap
 * too much to leave any gap get equally spaced centres instead, the only even spacing they have.
 */
export function distributeUnits(units: readonly Unit[], axis: Axis): Map<string, Shift> {
  const [pos, size] = axis === 'horizontal' ? (['x', 'w'] as const) : (['y', 'h'] as const)
  const centre = (unit: Unit) => unit[pos] + unit[size] / 2
  const sorted = [...units].sort((a, b) => centre(a) - centre(b))
  const first = sorted[0] as Unit
  const last = sorted.at(-1) as Unit
  const span = last[pos] + last[size] - first[pos]
  const gap = (span - sorted.reduce((sum, unit) => sum + unit[size], 0)) / (sorted.length - 1)
  const shifts = new Map<string, Shift>()
  let cursor = first[pos]
  const step = (centre(last) - centre(first)) / (sorted.length - 1)
  sorted.forEach((unit, index) => {
    const to = gap >= 0 ? cursor : centre(first) + step * index - unit[size] / 2
    cursor += unit[size] + gap
    const delta = to - unit[pos]
    shifts.set(unit.key, axis === 'horizontal' ? { dx: delta, dy: 0 } : { dx: 0, dy: delta })
  })
  return shifts
}

/**
 * Units laid out from `origin` in the order given: a row (tops aligned), a column (lefts
 * aligned), or a grid whose columns are as wide as their widest unit and rows as tall as their
 * tallest — a table, so mixed sizes still line up. A grid is as square as it can be unless told
 * how many columns.
 */
export function arrangeUnits(
  units: readonly Unit[],
  layout: Layout,
  origin: { x: number; y: number },
  gap: number,
  columns?: number,
): Map<string, Shift> {
  const count =
    layout === 'row'
      ? units.length
      : layout === 'column'
        ? 1
        : (columns ?? Math.ceil(Math.sqrt(units.length)))
  const widths: number[] = []
  const heights: number[] = []
  units.forEach((unit, index) => {
    const column = index % count
    const row = Math.floor(index / count)
    widths[column] = Math.max(widths[column] ?? 0, unit.w)
    heights[row] = Math.max(heights[row] ?? 0, unit.h)
  })
  const offset = (sizes: number[], upTo: number) =>
    sizes.slice(0, upTo).reduce((sum, size) => sum + size + gap, 0)
  return new Map(
    units.map((unit, index) => {
      const x = origin.x + offset(widths, index % count)
      const y = origin.y + offset(heights, Math.floor(index / count))
      return [unit.key, { dx: x - unit.x, dy: y - unit.y }]
    }),
  )
}
