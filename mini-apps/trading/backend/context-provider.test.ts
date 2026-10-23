import { describe, expect, test } from 'bun:test'

import { createTradingPublicContextProvider } from './context-provider'
import type { ResourceTradingService } from './resource-provider'
import type { ContextResolver } from '@localixai/mini-app-sdk/backend'

const service = {
  list: async () => [],
  ticker: async () => ({
    symbol: 'BTC/USDC:USDC',
    timestamp: 1,
    last: 65_000,
    bid: 64_999,
    ask: 65_001,
  }),
} as unknown as ResourceTradingService

const publicReference = {
  version: 1 as const,
  id: 'selected',
  kind: 'resource',
  uri: 'localix://resource/trade/public:demoex/markets/BTC%2FUSDC%3AUSDC/ticker',
  freshness: 'resolve-at-send' as const,
  presentation: { label: 'BTC ticker' },
  scope: { userId: 'u', sessionId: 's' },
}

describe('public Trading Context Fabric provider', () => {
  test('admits only public market data and captures a revisioned snapshot', async () => {
    const contribution = createTradingPublicContextProvider(service)
    const provider = contribution.provider as ContextResolver
    expect(contribution.destinations).toEqual(['edit-prediction', 'inline-completion', 'chat'])
    expect(provider.supports(publicReference, 'chat')).toBe(true)
    expect(
      provider.supports(
        { ...publicReference, uri: 'localix://resource/trade/saved-account/positions' },
        'chat',
      ),
    ).toBe(false)
    const result = await provider.resolve(
      publicReference,
      { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 10_000 },
      new AbortController().signal,
    )
    expect(result).toEqual([
      expect.objectContaining({
        providerId: 'trading:public-context',
        sensitivity: 'public',
        uri: publicReference.uri,
      }),
    ])
    expect(result[0]?.content).toContain('BTC/USDC:USDC')
    expect(result[0]?.revision).toMatch(/^trade-public-content:/)
  })

  test('does not issue a public market read after cancellation', async () => {
    const provider = createTradingPublicContextProvider(service).provider as ContextResolver
    const controller = new AbortController()
    controller.abort()
    expect(
      await provider.resolve(
        publicReference,
        { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 10_000 },
        controller.signal,
      ),
    ).toEqual([])
  })

  test('an account leaf is refused on EVERY entry point and never reaches the exchange', async () => {
    // A service that fails loudly: reaching it at all for a non-public URI is the bug.
    const reads: string[] = []
    const watched = {
      list: async () => {
        reads.push('list')
        return []
      },
      ticker: async () => {
        reads.push('ticker')
        return { symbol: 'X', timestamp: 1, last: 1, bid: 1, ask: 1 }
      },
      balances: async () => {
        reads.push('balances')
        return []
      },
      positions: async () => {
        reads.push('positions')
        return []
      },
    } as unknown as ResourceTradingService
    const provider = createTradingPublicContextProvider(watched).provider as ContextResolver
    const ctx = { destination: 'chat' as const, userId: 'u', sessionId: 's', maxBytes: 10_000 }

    for (const uri of [
      'localix://resource/trade/saved-account/positions',
      'localix://resource/trade/saved-account/balances',
      'localix://resource/trade/saved-account',
    ]) {
      const account = { ...publicReference, uri }
      expect(provider.supports(account, 'chat')).toBe(false)
      expect(await provider.estimate(account, ctx, new AbortController().signal)).toEqual({
        bytes: 0,
        tokens: 0,
      })
      expect(await provider.resolve(account, ctx, new AbortController().signal)).toEqual([])
    }
    expect(reads).toEqual([])
  })
})
