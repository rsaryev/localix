/**
 * The NOTICE contract of the `localix://resource/trade/` menu tree.
 *
 * A notice row ("Could not list venues", "Showing 12 of 40 venues") is pure in-band
 * information. The shared owner — `noticeNode`/`truncationNotice` in
 * `agent-core/resource-refs/provider.ts` — is what makes that true: it sets `notice: true`
 * (the flag the composer `@`-menu filters selectable rows on, `.filter((n) => !n.notice)`)
 * and keys the row off a `#notice` sentinel rather than an addressable target.
 *
 * This provider used to hand-roll its own notice rows and lost BOTH: the placeholder rendered
 * as a selectable menu item carrying a REAL `localix://resource/trade/public:hyperliquid` URI, so a user could
 * link a failure message into chat as if it were the Hyperliquid venue. These tests pin the
 * rows to the owner's shape so the copy cannot come back.
 */
import { describe, expect, test } from 'bun:test'
import { connectionNodes, marketNodes, marketsLevelNodes } from './resource-tree'
import { MAX_MARKETS, type ResourceTradingService } from './resource-shared'
import type { Market } from './contracts'
import type { ResourceNode } from '@localixai/mini-app-sdk/backend'

/** The composer `@`-menu's real selectable set (`atRefSuggestions` / `useAtRefAutocomplete`). */
const selectable = (nodes: ResourceNode[]) => nodes.filter((n) => !n.notice)
const notices = (nodes: ResourceNode[]) => nodes.filter((n) => n.notice)

const svc = (over: Partial<ResourceTradingService>): ResourceTradingService =>
  ({
    list: async () => [],
    exchanges: async () => [],
    markets: async () => [],
    ...over,
  }) as ResourceTradingService

const mkt = (symbol: string): Market =>
  ({
    symbol,
    base: symbol.split('/')[0],
    quote: 'USDC',
    type: 'swap',
    active: true,
    contract: true,
  }) as Market

const boom = () => {
  throw new Error('catalog offline')
}

describe('localix://resource/trade/ notice rows are never selectable', () => {
  test('a failed venue catalog is a notice, not a linkable venue', async () => {
    const nodes = await connectionNodes(svc({ exchanges: boom }), 'u')

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.label).toBe('Could not list venues')
    expect(nodes[0]!.detail).toContain('catalog offline')
    // THE BUG: this row used to carry `localix://resource/trade/public:hyperliquid` and no `notice` flag, so the
    // `@`-menu offered it — and picking it linked the real Hyperliquid venue.
    expect(nodes[0]!.notice).toBe(true)
    expect(nodes[0]!.uri).not.toBe('localix://resource/trade/public:hyperliquid')
    expect(nodes[0]!.uri.endsWith('#notice')).toBe(true)
    expect(selectable(nodes)).toEqual([])
  })

  test('the venue truncation row is a notice', async () => {
    const catalog = Array.from({ length: 40 }, (_, i) => ({
      id: `venue${String(i).padStart(2, '0')}`,
      name: `Venue ${String(i).padStart(2, '0')}`,
      requiredCredentials: [],
    }))
    const nodes = await connectionNodes(svc({ exchanges: async () => catalog }), 'u')

    const hints = notices(nodes)
    expect(hints).toHaveLength(1)
    expect(hints[0]!.label).toContain('Showing 12 of 40')
    expect(hints[0]!.uri.endsWith('#notice')).toBe(true)
    // Every row the menu will actually offer is a real, drillable venue.
    expect(selectable(nodes)).toHaveLength(12)
    expect(selectable(nodes).every((n) => n.hasChildren)).toBe(true)
  })

  test('a failed markets read (type level) is a notice', async () => {
    const nodes = await marketsLevelNodes(svc({ markets: boom }), 'u', 'public:binance')

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.label).toBe('Could not list markets')
    expect(nodes[0]!.notice).toBe(true)
    expect(nodes[0]!.uri).not.toBe('localix://resource/trade/public:binance/markets')
    expect(selectable(nodes)).toEqual([])
  })

  test('a failed markets read (market level) is a notice', async () => {
    const nodes = await marketNodes(svc({ markets: boom }), 'u', 'public:binance')

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.label).toBe('Could not list markets')
    expect(nodes[0]!.notice).toBe(true)
    expect(selectable(nodes)).toEqual([])
  })

  test('the markets truncation row is a notice, and the markets themselves stay selectable', async () => {
    const all = Array.from({ length: MAX_MARKETS + 50 }, (_, i) => mkt(`SYM${i}/USDC`))
    const nodes = await marketNodes(svc({ markets: async () => all }), 'u', 'public:binance')

    const hints = notices(nodes)
    expect(hints).toHaveLength(1)
    expect(hints[0]!.label).toContain(`Showing ${MAX_MARKETS} of ${MAX_MARKETS + 50}`)
    expect(hints[0]!.uri.endsWith('#notice')).toBe(true)
    expect(selectable(nodes)).toHaveLength(MAX_MARKETS)
    // A notice must never be mistaken for a market: no drill target, no link action.
    expect(hints[0]!.hasChildren).toBe(false)
    expect(hints[0]!.actions).toBeUndefined()
  })

  test('a healthy listing mints no notices at all', async () => {
    const nodes = await marketNodes(
      svc({ markets: async () => [mkt('BTC/USDC'), mkt('ETH/USDC')] }),
      'u',
      'public:binance',
    )

    expect(notices(nodes)).toEqual([])
    expect(selectable(nodes)).toHaveLength(2)
  })
})
