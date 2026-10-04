import { describe, expect, test } from 'bun:test'
import type { Market, MarketType } from '../../backend/contracts'
import {
  marketDexBadge,
  marketInactiveBadge,
  marketLeverageBadge,
  marketRowSubtitle,
} from './marketBadges'
import { readCode } from '@localixai/source-lint'

const m = (
  base: string,
  type: MarketType = 'swap',
  maxLeverage?: number,
  operator?: string,
): Market => ({
  symbol: `${base}/USDC:USDC`,
  base,
  quote: 'USDC',
  type,
  active: true,
  contract: type !== 'spot',
  precision: {},
  limits: maxLeverage === undefined ? {} : { maxLeverage },
  ...(operator ? { operator } : {}),
})

describe('marketDexBadge', () => {
  test('shows the operator the venue reported, lower-cased', () => {
    expect(marketDexBadge(m('XYZ-AAPL', 'swap', undefined, 'XYZ'))).toBe('xyz')
    expect(marketDexBadge(m('KM-AAPL', 'swap', undefined, 'KM'))).toBe('km')
    expect(marketDexBadge(m('MKTS-AAPL', 'swap', undefined, 'MKTS'))).toBe('mkts')
  })

  test("the exchange's own market has no badge", () => {
    expect(marketDexBadge(m('AAPL'))).toBeNull()
    expect(marketDexBadge(m('BTC'))).toBeNull()
    expect(marketDexBadge(m('1000PEPE'))).toBeNull()
  })

  test('a hyphen alone is never read as an operator', () => {
    // ZM-USDC is an ordinary market the exchange itself lists; only the venue's flag licenses a badge.
    expect(marketDexBadge(m('ZM-USDC'))).toBeNull()
  })

  test('does not hardcode any operator name — an unseen one still badges', () => {
    expect(marketDexBadge(m('NEWDEX-TSLA', 'swap', undefined, 'NEWDEX'))).toBe('newdex')
  })
})

describe('marketLeverageBadge', () => {
  test('renders the venue cap as Nx', () => {
    expect(marketLeverageBadge(m('BTC', 'swap', 30))).toBe('30x')
    expect(marketLeverageBadge(m('BTC', 'swap', 2.5))).toBe('2.5x')
  })

  test('absent / non-positive leverage has no badge', () => {
    expect(marketLeverageBadge(m('BTC', 'swap'))).toBeNull()
    expect(marketLeverageBadge(m('BTC', 'swap', 0))).toBeNull()
  })
})

describe('marketRowSubtitle', () => {
  const mk = (symbol: string, base: string, quote: string, type: MarketType): Market => ({
    symbol,
    base,
    quote,
    type,
    active: true,
    contract: type !== 'spot',
    precision: {},
    limits: {},
  })

  test('a spot row does not spell its own symbol back at itself', () => {
    // The row title already reads AAPL/USDC.
    expect(marketRowSubtitle(mk('AAPL/USDC', 'AAPL', 'USDC', 'spot'))).toBe('Spot')
  })

  test('a derivative shows the pair, because its symbol carries a settle suffix', () => {
    expect(marketRowSubtitle(mk('BTC/USDC:USDC', 'BTC', 'USDC', 'swap'))).toBe(
      'BTC/USDC · Perpetual',
    )
  })

  test('the market type is always stated — the symbol never says it', () => {
    // Spot and perpetual on the same pair are different trades; only this line separates them.
    expect(marketRowSubtitle(mk('BTC/USDC', 'BTC', 'USDC', 'spot'))).toContain('Spot')
    expect(marketRowSubtitle(mk('BTC/USDC:USDC', 'BTC', 'USDC', 'swap'))).toContain('Perpetual')
  })
})

describe('marketInactiveBadge', () => {
  test('an inactive market gets the badge', () => {
    expect(marketInactiveBadge({ ...m('X'), active: false })).toBe('inactive')
  })
  test('an active market gets none', () => {
    expect(marketInactiveBadge(m('X'))).toBeNull()
  })
})

describe('the switcher and chart header flag an inactive market (source lint)', () => {
  test('the picker row renders the inactive badge', () => {
    const picker = readCode(new URL('../ui/MarketPicker.tsx', import.meta.url))
    expect(picker).toContain('marketInactiveBadge(market)')
  })
  test('the chart header renders the inactive badge', () => {
    const header = readCode(new URL('../ui/ChartHeader.tsx', import.meta.url))
    expect(header).toContain('marketInactiveBadge(market)')
  })
})
