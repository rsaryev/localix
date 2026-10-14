/**
 * The ws-frame contribution's channel gate. The claim worth pinning is the security one:
 * this surface is public market data only, so the private account channels must never open
 * a stream — even though the underlying registry could serve them for a saved connection.
 */
import { describe, expect, test } from 'bun:test'
import { createTradingWsFrames } from './ws-frames'
import type { TradingStreamRegistry } from './stream'
import type { StreamParams } from './backend'

/** The socket identity the host binds; public market data does not depend on it. */
const SOCKET = { userId: 'u1' }

function harness() {
  const subscribed: StreamParams[] = []
  const registry = {
    subscribe: (_id: string, params: StreamParams) => {
      subscribed.push(params)
      return () => {}
    },
  } as unknown as TradingStreamRegistry
  const [contribution] = createTradingWsFrames(registry)
  if (!contribution) throw new Error('no contribution')
  return { contribution, subscribed }
}

describe('channel gate', () => {
  test('the four public channels subscribe', () => {
    const { contribution, subscribed } = harness()
    for (const channel of ['ticker', 'ohlcv', 'orderbook', 'trades']) {
      contribution.start({ connectionId: 'c1', channel, symbol: 'BTC/USDT' }, () => {}, SOCKET)
    }
    expect(subscribed.map((p) => p.channel)).toEqual(['ticker', 'ohlcv', 'orderbook', 'trades'])
  })

  test('the private account channels never reach the registry', () => {
    const { contribution, subscribed } = harness()
    // `key` is optional on the contribution contract; this contribution always provides it.
    const key = contribution.key
    expect(key).toBeDefined()
    for (const channel of ['orders', 'positions', 'balance', 'myTrades']) {
      contribution.start({ connectionId: 'c1', channel }, () => {}, SOCKET)
      expect(key!({ connectionId: 'c1', channel })).toBe('invalid')
    }
    expect(subscribed).toEqual([])
  })
})
