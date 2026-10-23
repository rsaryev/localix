import { describe, expect, test } from 'bun:test'

import { normalizeTradingArea } from './tradingArea'

describe('Trading Workspace view persistence', () => {
  test('accepts every supported area', () => {
    expect(normalizeTradingArea('overview')).toBe('overview')
    expect(normalizeTradingArea('markets')).toBe('markets')
  })

  test('falls back safely for corrupt or future values', () => {
    expect(normalizeTradingArea('strategies')).toBe('overview')
    expect(normalizeTradingArea('portfolio')).toBe('overview')
    expect(normalizeTradingArea(null)).toBe('overview')
    expect(normalizeTradingArea({ area: 'markets' })).toBe('overview')
  })
})
