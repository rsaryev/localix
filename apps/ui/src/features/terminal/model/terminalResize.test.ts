import { describe, expect, test } from 'bun:test'
import { shouldFitHost, planPtyResize, MIN_PTY_COLS, MIN_PTY_ROWS } from './terminalResize'

describe('shouldFitHost', () => {
  test('real dimensions → fit', () => {
    expect(shouldFitHost(640, 320)).toBe(true)
    expect(shouldFitHost(1, 1)).toBe(true)
  })

  test('hidden / transitional hosts never fit (0, negative, NaN)', () => {
    expect(shouldFitHost(0, 320)).toBe(false) // collapsed width mid-layout
    expect(shouldFitHost(640, 0)).toBe(false) // collapsed height (sash to nothing)
    expect(shouldFitHost(0, 0)).toBe(false) // hidden keep-alive body
    expect(shouldFitHost(-4, 100)).toBe(false)
    expect(shouldFitHost(Number.NaN, 100)).toBe(false) // display:none computed style
    expect(shouldFitHost(100, Number.NaN)).toBe(false)
  })
})

describe('planPtyResize', () => {
  test('first send: passes real dims through', () => {
    expect(planPtyResize(120, 32, null)).toEqual({ cols: 120, rows: 32 })
  })

  test('dedupes an unchanged size (no gratuitous SIGWINCH)', () => {
    expect(planPtyResize(120, 32, { cols: 120, rows: 32 })).toBeNull()
  })

  test('re-sends when either dimension changed', () => {
    expect(planPtyResize(121, 32, { cols: 120, rows: 32 })).toEqual({ cols: 121, rows: 32 })
    expect(planPtyResize(120, 31, { cols: 120, rows: 32 })).toEqual({ cols: 120, rows: 31 })
  })

  test('clamps degenerate-but-positive dims up to the floor (never < 2)', () => {
    expect(planPtyResize(1, 1, null)).toEqual({ cols: MIN_PTY_COLS, rows: MIN_PTY_ROWS })
    expect(planPtyResize(2, 1, null)).toEqual({ cols: 2, rows: MIN_PTY_ROWS })
  })

  test('clamped result still dedupes against the last CLAMPED send', () => {
    // xterm stuck at 2×1 (fit-addon floor) → we sent 2×2; a repeat plans nothing.
    expect(planPtyResize(2, 1, { cols: 2, rows: 2 })).toBeNull()
  })

  test('invalid dims (0, negative, NaN, fractional) plan nothing', () => {
    expect(planPtyResize(0, 24, null)).toBeNull()
    expect(planPtyResize(80, 0, null)).toBeNull()
    expect(planPtyResize(-1, 24, null)).toBeNull()
    expect(planPtyResize(Number.NaN, 24, null)).toBeNull()
    expect(planPtyResize(80.5, 24, null)).toBeNull()
  })
})
