import { describe, expect, test } from 'bun:test'

import { formatCountdown } from './useCountdown'

describe('formatCountdown', () => {
  test('null target uses the idle label', () => {
    expect(formatCountdown(null)).toBe('idle')
    expect(formatCountdown(null, { whenIdle: 'off' })).toBe('off')
  })

  test('elapsed target uses the elapsed label', () => {
    const past = new Date(Date.now() - 5000).toISOString()
    expect(formatCountdown(past)).toBe('soon')
    expect(formatCountdown(past, { whenElapsed: 'now' })).toBe('now')
  })

  test('invalid target falls back to the idle label', () => {
    expect(formatCountdown('not-a-date')).toBe('idle')
    expect(formatCountdown('not-a-date', { whenIdle: 'off' })).toBe('off')
  })

  test('future target renders "in Xm Ys" / "in Ys"', () => {
    const future = new Date(Date.now() + 125_000).toISOString()
    expect(formatCountdown(future)).toMatch(/^in 2m \d+s$/)
    const soon = new Date(Date.now() + 30_000).toISOString()
    expect(formatCountdown(soon)).toMatch(/^in \d+s$/)
  })
})
