import { describe, expect, test } from 'bun:test'
import { marketListState } from './marketListState'
import type { MarketsState } from './useMarkets'

const s = (over: Partial<MarketsState> = {}): MarketsState => ({
  markets: [],
  loading: false,
  unreachable: false,
  error: null,
  ...over,
})

describe('marketListState', () => {
  test('a failed read is never rendered as a venue that lists nothing', () => {
    // The whole point. `No matching markets` is a claim about the venue.
    expect(marketListState(s({ error: { message: 'bad request' } }), 0)).toBe('error')
  })

  test('an unreachable venue is a quiet state, and outranks the error message', () => {
    expect(marketListState(s({ unreachable: true }), 0)).toBe('unreachable')
    expect(marketListState(s({ unreachable: true, error: { message: 'x' } }), 0)).toBe(
      'unreachable',
    )
  })

  test('a genuinely empty result says empty — only a SUCCESSFUL read can establish that', () => {
    expect(marketListState(s(), 0)).toBe('empty')
  })

  test('rows render whenever there are rows', () => {
    expect(marketListState(s(), 3)).toBe('list')
  })

  test('a refresh over an existing list keeps the list rather than blanking it', () => {
    // Typing re-queries the server; the rows on screen are a moment old, not wrong.
    expect(marketListState(s({ loading: true }), 3)).toBe('list')
    expect(marketListState(s({ loading: true }), 0)).toBe('loading')
  })

  test('a failure that arrives while rows are still on screen is reported, not hidden behind them', () => {
    expect(marketListState(s({ error: { message: 'venue said no' } }), 5)).toBe('error')
    expect(marketListState(s({ unreachable: true }), 5)).toBe('unreachable')
  })
})
