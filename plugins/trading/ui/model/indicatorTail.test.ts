import { describe, expect, it } from 'bun:test'
import type { IndicatorPoint } from './indicator-contracts'
import { indicatorTailStart } from './indicatorTail'

const pts = (values: Array<number | undefined>, from = 0): IndicatorPoint[] =>
  values.map((value, i) =>
    value === undefined
      ? ({ time: from + i } as IndicatorPoint)
      : ({ time: from + i, value } as IndicatorPoint),
  )

describe('indicatorTailStart', () => {
  it('updates only the last point on a tick', () => {
    expect(indicatorTailStart(pts([1, 2, 3]), pts([1, 2, 4]))).toBe(2)
  })

  it('updates the corrected last point and the appended one on a rollover', () => {
    expect(indicatorTailStart(pts([1, 2, 3]), pts([1, 2, 3.5, 5]))).toBe(2)
  })

  it('reports nothing to push for an identical series', () => {
    expect(indicatorTailStart(pts([1, 2, 3]), pts([1, 2, 3]))).toBe(3)
  })

  it('treats warm-up whitespace points as comparable', () => {
    expect(indicatorTailStart(pts([undefined, 2, 3]), pts([undefined, 2, 4]))).toBe(2)
  })

  it('falls back to a full reload when an older point repaints', () => {
    expect(indicatorTailStart(pts([1, 2, 3]), pts([1, 9, 3]))).toBeNull()
  })

  it('falls back on a color change behind the tail', () => {
    const prev = pts([1, 2, 3])
    const next = pts([1, 2, 3])
    ;(next[0] as { color?: string }).color = '#fff'
    expect(indicatorTailStart(prev, next)).toBeNull()
  })

  it('falls back on shrink, multi-point growth, a shifted window or an empty chart', () => {
    expect(indicatorTailStart(pts([1, 2, 3]), pts([1, 2]))).toBeNull()
    expect(indicatorTailStart(pts([1, 2]), pts([1, 2, 3, 4]))).toBeNull()
    expect(indicatorTailStart(pts([1, 2, 3]), pts([1, 2, 3], 1))).toBeNull()
    expect(indicatorTailStart([], pts([1]))).toBeNull()
  })
})
