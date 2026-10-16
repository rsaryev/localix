import { describe, expect, it } from 'bun:test'
import { ADAPTIVE_CADENCE_WINDOW, adaptiveDebounceMs, pushCadenceSample } from './adaptiveDebounce'

const BOUNDS = { minMs: 500, maxMs: 900, defaultMs: 900 }

describe('adaptiveDebounceMs', () => {
  it('falls back to the caller default without cadence history', () => {
    expect(adaptiveDebounceMs([], BOUNDS)).toBe(900)
    expect(adaptiveDebounceMs([Number.NaN, -5, Infinity], BOUNDS)).toBe(900)
  })

  it('stays inside the caller window for any input', () => {
    for (const samples of [[0], [5], [5000], [120, 130], [400, 400, 400], [1, 999]]) {
      const delay = adaptiveDebounceMs(samples, BOUNDS)
      expect(delay).toBeGreaterThanOrEqual(BOUNDS.minMs)
      expect(delay).toBeLessThanOrEqual(BOUNDS.maxMs)
    }
  })

  it('makes a burst typist wait longer than a deliberate one', () => {
    expect(adaptiveDebounceMs([25, 30, 20], BOUNDS)).toBeGreaterThan(
      adaptiveDebounceMs([380, 420, 400], BOUNDS),
    )
  })

  it('uses the median so one long pause cannot dominate a burst', () => {
    expect(adaptiveDebounceMs([30, 30, 4000], BOUNDS)).toBe(
      adaptiveDebounceMs([30, 30, 30], BOUNDS),
    )
  })

  it('respects each surface window independently', () => {
    const editor = { minMs: 350, maxMs: 700, defaultMs: 500 }
    expect(adaptiveDebounceMs([1000], editor)).toBe(350)
    expect(adaptiveDebounceMs([1000], BOUNDS)).toBe(500)
  })
})

describe('pushCadenceSample', () => {
  it('bounds the window to the most recent gaps', () => {
    let window: number[] = []
    for (let index = 0; index < ADAPTIVE_CADENCE_WINDOW + 3; index++) {
      window = pushCadenceSample(window, index)
    }
    expect(window).toHaveLength(ADAPTIVE_CADENCE_WINDOW)
    expect(window.at(-1)).toBe(ADAPTIVE_CADENCE_WINDOW + 2)
  })

  it('ignores an unusable sample instead of poisoning the median', () => {
    expect(pushCadenceSample([100], Number.NaN)).toEqual([100])
    expect(pushCadenceSample([100], -1)).toEqual([100])
  })
})
