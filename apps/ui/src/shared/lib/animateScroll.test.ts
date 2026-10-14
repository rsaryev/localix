import { describe, expect, test } from 'bun:test'
import { planScroll, scrollDuration } from './animateScroll'

// viewport 600 inside a 10000px scroll height — a long transcript.
const plan = (from: number, to: number) => planScroll(from, to, 600, 10_000)

describe('planScroll', () => {
  test('a near target is animated the whole way', () => {
    expect(plan(0, 400)).toEqual({ from: 0, to: 400, distance: 400 })
  })

  test('a far target teleports first and animates only the last stretch', () => {
    // The point of the clamp: a jump to the end of a long list must not flicker through
    // thousands of rows to show motion nobody can read, at a paint per row. The arrival
    // looks the same from anywhere.
    const forwards = plan(0, 9000)
    expect(forwards.to).toBe(9000)
    expect(forwards.from).toBe(9000 - 1200)
    expect(forwards.distance).toBe(1200)

    const backwards = plan(9000, 0)
    expect(backwards.to).toBe(0)
    expect(backwards.from).toBe(1200)
    expect(backwards.distance).toBe(1200)
  })

  test('the target is clamped to scrollable space that exists', () => {
    // Animating past the end buys time going nowhere — `scrollTop` refuses, and the motion
    // appears to freeze before it finishes.
    expect(plan(0, 99_999).to).toBe(10_000 - 600)
    expect(plan(500, -200).to).toBe(0)
  })

  test('a container shorter than its viewport has nowhere to go', () => {
    expect(planScroll(0, 500, 600, 400)).toEqual({ from: 0, to: 0, distance: 0 })
  })

  test('already there is no distance at all', () => {
    expect(plan(300, 300).distance).toBe(0)
  })
})

describe('scrollDuration', () => {
  test('scales with distance between the two ends of the motion scale', () => {
    expect(scrollDuration(0)).toBe(200)
    expect(scrollDuration(1200)).toBe(500)
    expect(scrollDuration(600)).toBe(350)
  })

  test('never exceeds the slow end, however far the caller asks', () => {
    // Distance is clamped before it gets here, but a caller passing a raw delta must not be
    // able to buy a five-second scroll.
    expect(scrollDuration(100_000)).toBe(500)
  })

  test('a short hop and a long jump differ, which is the whole point', () => {
    expect(scrollDuration(100)).toBeLessThan(scrollDuration(1000))
  })
})
