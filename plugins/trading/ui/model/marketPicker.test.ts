import { describe, expect, test } from 'bun:test'
import type { Market, MarketType } from '../../backend/contracts'
import { tickersRequestSchema } from '../../backend/contracts'
import { DEFAULT_CAP, buildMarketTabs, filterMarketRows } from './marketPicker'

const m = (symbol: string, type: MarketType = 'spot', active = true): Market => {
  const [base, quote] = symbol.split(/[/:]/)
  return {
    symbol,
    base,
    quote: quote ?? 'USDC',
    type,
    active,
    contract: type !== 'spot',
    precision: {},
    limits: {},
  }
}

describe('buildMarketTabs', () => {
  test('always leads with All then Favourites', () => {
    const tabs = buildMarketTabs([m('BTC/USDC', 'spot')])
    expect(tabs.slice(0, 2).map((t) => t.key)).toEqual(['all', 'favourites'])
  })

  test('adds one tab per market type present, in the fixed order', () => {
    const tabs = buildMarketTabs([m('ETH/USDC:USDC', 'swap'), m('BTC/USDC', 'spot')])
    expect(tabs.map((t) => t.key)).toEqual(['all', 'favourites', 'type:spot', 'type:swap'])
    // The perpetual tab is labelled by the shared TYPE_LABEL, not a hardcoded "Perps".
    expect(tabs.find((t) => t.key === 'type:swap')?.label).toBe('Perpetual')
  })

  test('never invents a type tab the venue does not report', () => {
    const tabs = buildMarketTabs([m('BTC/USDC', 'spot'), m('SOL/USDC', 'spot')])
    expect(tabs.map((t) => t.key)).toEqual(['all', 'favourites', 'type:spot'])
  })

  test('empty roster still offers All + Favourites', () => {
    expect(buildMarketTabs([]).map((t) => t.key)).toEqual(['all', 'favourites'])
  })
})

describe('filterMarketRows', () => {
  const roster = [
    m('BTC/USDC', 'spot'),
    m('ETH/USDC:USDC', 'swap'),
    m('SOL/USDC', 'spot'),
    m('DOGE/USDT', 'spot'),
  ]

  test('the All tab keeps every market', () => {
    expect(filterMarketRows(roster, { tab: 'all' }).total).toBe(4)
  })

  test('a type tab keeps only that type', () => {
    const r = filterMarketRows(roster, { tab: 'type:swap' })
    expect(r.total).toBe(1)
    expect(r.rows.map((x) => x.symbol)).toEqual(['ETH/USDC:USDC'])
  })

  test('the Favourites tab keeps only starred symbols', () => {
    const r = filterMarketRows(roster, {
      tab: 'favourites',
      favourites: new Set(['SOL/USDC', 'ETH/USDC:USDC']),
    })
    expect(new Set(r.rows.map((x) => x.symbol))).toEqual(new Set(['SOL/USDC', 'ETH/USDC:USDC']))
  })

  test('query matches symbol / base / quote and combines with the tab', () => {
    expect(filterMarketRows(roster, { tab: 'all', query: 'doge' }).total).toBe(1)
    expect(filterMarketRows(roster, { tab: 'all', query: 'usdc' }).total).toBe(3)
    // Query narrows WITHIN a tab.
    expect(filterMarketRows(roster, { tab: 'type:spot', query: 'eth' }).total).toBe(0)
  })

  test('caps the rows and reports it', () => {
    const many = Array.from({ length: 10 }, (_, i) => m(`C${i}/USDC`, 'spot'))
    const r = filterMarketRows(many, { tab: 'all', cap: 4 })
    expect(r.rows).toHaveLength(4)
    expect(r.total).toBe(10)
    expect(r.capped).toBe(true)
  })

  test('is not capped when everything fits', () => {
    expect(filterMarketRows(roster, { tab: 'all', cap: 50 }).capped).toBe(false)
  })
})

describe('the Third-party tab', () => {
  const own = m('BTC/USDC:USDC', 'swap')
  const builder: Market = { ...m('XYZ-SP500/USDC:USDC', 'swap'), operator: 'XYZ' }

  test('appears only when some market was deployed by someone other than the exchange', () => {
    expect(buildMarketTabs([own]).map((t) => t.key)).not.toContain('operator')
    expect(buildMarketTabs([own, builder]).map((t) => t.key)).toContain('operator')
  })

  test('it comes after the market-type tabs, not between them', () => {
    const keys = buildMarketTabs([own, builder]).map((t) => t.key)
    expect(keys.indexOf('operator')).toBe(keys.length - 1)
  })

  test('it holds exactly the markets carrying an operator', () => {
    const { rows } = filterMarketRows([own, builder], { tab: 'operator' })
    expect(rows.map((r) => r.symbol)).toEqual(['XYZ-SP500/USDC:USDC'])
  })

  test('those markets still appear under All and under their own type', () => {
    // A third party's perp is a perp. The tab is a lens, not a partition.
    expect(filterMarketRows([own, builder], { tab: 'all' }).rows).toHaveLength(2)
    expect(filterMarketRows([own, builder], { tab: 'type:swap' }).rows).toHaveLength(2)
  })
})

describe('the row cap is bound to what one price request can carry', () => {
  test('a full page of rows fits the tickers route in a single request', () => {
    // The picker prices exactly the rows on screen. A cap above the route's limit would render rows
    // the request cannot carry, and an unpriced row is indistinguishable from one the venue declined
    // to quote.
    const symbols = Array.from({ length: DEFAULT_CAP }, (_, i) => `SYM${i}/USDC`)
    expect(() => tickersRequestSchema.parse({ symbols })).not.toThrow()
  })

  test('one row past the cap would not fit — so the cap is the binding, not a coincidence', () => {
    const symbols = Array.from({ length: DEFAULT_CAP + 1 }, (_, i) => `SYM${i}/USDC`)
    expect(() => tickersRequestSchema.parse({ symbols })).toThrow()
  })
})
