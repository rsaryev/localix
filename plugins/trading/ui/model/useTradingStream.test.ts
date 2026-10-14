import { describe, expect, test } from 'bun:test'
import { nextDelivering, nextResyncState } from './useTradingStream'
import { readCode } from '@localixai/source-lint'

/**
 * A delta channel (`watchOrders`) cannot heal itself: the venue pushes an order ONCE when it
 * changes. If the socket was down when an order was cancelled, that cancellation is never resent —
 * so the open-orders table keeps showing it, and a user reads a dead stop-loss as an armed one.
 * The only cure is a REST resync on the down→live edge.
 */
describe('nextResyncState', () => {
  test('the first live status is the subscription starting, not a recovery', () => {
    expect(nextResyncState(false, 'live')).toEqual({ wasDown: false, resync: false })
  })

  test('a down status arms the resync without triggering one', () => {
    expect(nextResyncState(false, 'down')).toEqual({ wasDown: true, resync: false })
  })

  test('live after down resyncs — the venue socket restarted and the delta stream has a hole', () => {
    expect(nextResyncState(true, 'live')).toEqual({ wasDown: false, resync: true })
  })

  test('staying down does not resync, and stays armed', () => {
    expect(nextResyncState(true, 'down')).toEqual({ wasDown: true, resync: false })
  })

  test('a second live in a row does not resync again', () => {
    const first = nextResyncState(true, 'live')
    expect(nextResyncState(first.wasDown, 'live')).toEqual({ wasDown: false, resync: false })
  })
})

describe('nextDelivering', () => {
  test('a payload proves delivery', () => {
    expect(nextDelivering(false, 'data')).toBe(true)
    expect(nextDelivering(true, 'data')).toBe(true)
  })

  test('a `live` status is NOT delivery — the socket came up, the market did not print', () => {
    // The registry declares a stream live 800ms after starting its loop. Reading that as delivery
    // pauses the REST fallback over a market that has said nothing, and the surface shows the last
    // thing it read as if it were now.
    expect(nextDelivering(false, 'live')).toBe(false)
  })

  test('a `live` status does not undo a delivery either', () => {
    expect(nextDelivering(true, 'live')).toBe(true)
  })

  test('a stream going down stops delivering, whatever it delivered before', () => {
    // Otherwise the corpse of the subscription keeps the fallback disabled forever.
    expect(nextDelivering(true, 'down')).toBe(false)
    expect(nextDelivering(false, 'down')).toBe(false)
  })
})

/**
 * A REST fallback exists to cover a feed that is not speaking. Gating it on `live` — the socket
 * loop being up — hands every surface the same defect in a different costume: no price for a quiet
 * ticker, a frozen snapshot for a quiet order book (which the order ticket then walks to estimate
 * slippage), a last bar that never closes for a quiet chart. Types pass, tests pass, the number on
 * screen is from a moment that has gone. So pin the gate at the call sites.
 */
describe('every REST fallback pauses on delivery, never on liveness', () => {
  const sources: Array<[string, string]> = [
    ['OrderBook.tsx', '../ui/OrderBook.tsx'],
    ['useTicker.ts', './useTicker.ts'],
    ['useOhlcv.ts', './useOhlcv.ts'],
  ]

  for (const [label, path] of sources) {
    test(`${label} does not gate useVisiblePolling on \`live\``, () => {
      const src = readCode(new URL(path, import.meta.url))
      const call = src.match(/useVisiblePolling\(\{([\s\S]*?)\n {2}\}\)/)
      expect(call, `useVisiblePolling({...}) call not found in ${label}`).not.toBeNull()
      // Comments inside the call may (and do) discuss `live`; only the code is under test —
      // `readCode` has already blanked them, so no second stripper here.
      expect(call![1]!).not.toMatch(/\blive\b/)
    })
  }

  test('the ticker plan is fed delivery, not liveness', () => {
    const src = readCode(new URL('./useTicker.ts', import.meta.url))
    expect(src).toMatch(/streamHasDelivered:\s*delivering/)
  })
})
