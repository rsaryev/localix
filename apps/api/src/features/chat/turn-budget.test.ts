import { describe, expect, test } from 'bun:test'

import { clampMaxTurns, DEFAULT_MAX_TURNS, MAX_TURNS_STEPS, MIN_MAX_TURNS } from './turn-budget'

describe('clampMaxTurns — one range, so no reader repeats the check', () => {
  test('an unset cap is the default, and so is a value that is not a number', () => {
    expect(clampMaxTurns(undefined)).toBe(DEFAULT_MAX_TURNS)
    expect(clampMaxTurns(Number.NaN)).toBe(DEFAULT_MAX_TURNS)
    expect(clampMaxTurns(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_TURNS)
  })

  test('values outside the range snap into it, and fractions round', () => {
    expect(clampMaxTurns(0)).toBe(MIN_MAX_TURNS)
    expect(clampMaxTurns(-40)).toBe(MIN_MAX_TURNS)
    expect(clampMaxTurns(99_999)).toBe(DEFAULT_MAX_TURNS)
    expect(clampMaxTurns(4.6)).toBe(5)
  })
})

describe('the scale the composer cycles through', () => {
  test('it has five increasing presets from one turn to no cap', () => {
    const steps: number[] = [...MAX_TURNS_STEPS]
    expect(steps).toEqual([1, 5, 20, 100, DEFAULT_MAX_TURNS])
    expect(steps[0]).toBe(MIN_MAX_TURNS)
    expect(steps.at(-1)).toBe(DEFAULT_MAX_TURNS)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
  })

  test('every step is inside the range, so the control cannot produce an invalid value', () => {
    for (const step of MAX_TURNS_STEPS) expect(clampMaxTurns(step)).toBe(step)
  })
})
