import { describe, expect, test } from 'bun:test'
import type { Market, PrecisionMode } from '../../backend/contracts'
import {
  chartPriceFormat,
  decimalsForValue,
  decimalsFromTick,
  formatCompactVolume,
  formatCountdown,
  formatFixed,
  formatFundingRate,
  formatPercent,
  formatPrice,
  formatSize,
} from './formatQuote'

const market = (price?: number, amount?: number): Market => ({
  symbol: 'BTC/USDC',
  base: 'BTC',
  quote: 'USDC',
  type: 'spot',
  active: true,
  contract: false,
  precision: { price, amount },
  limits: {},
})

describe('decimalsFromTick', () => {
  test('a whole tick has no fractional part', () => {
    expect(decimalsFromTick(1)).toBe(0)
    expect(decimalsFromTick(10)).toBe(0)
  })
  test('a fractional tick counts its own decimals', () => {
    expect(decimalsFromTick(0.1)).toBe(1)
    expect(decimalsFromTick(0.0005)).toBe(4)
    expect(decimalsFromTick(0.0000001)).toBe(7) // exponent form expanded
  })
  test('missing / invalid → null', () => {
    expect(decimalsFromTick(undefined)).toBeNull()
    expect(decimalsFromTick(0)).toBeNull()
    expect(decimalsFromTick(-1)).toBeNull()
  })
})

describe('decimalsForValue branches on precision mode', () => {
  const cases: Array<[PrecisionMode, number, number, number | null]> = [
    ['tick', 1, 63851, 0], // tick of 1 → 0 decimals
    ['tick', 0.0005, 0.1234, 4],
    ['decimals', 2, 12.3, 2], // a literal decimal-place count
    ['significant', 5, 63851, 0], // 5 sig figs, 5 integer digits → 0 decimals
    ['significant', 5, 0.12345, 5], // 5 sig figs at magnitude <1 → 5 decimals
  ]
  test.each(cases)('%s precision=%p value=%p → %p', (mode, precision, value, expected) => {
    expect(decimalsForValue(value, precision, mode)).toBe(expected)
  })
  test('invalid precision → null', () => {
    expect(decimalsForValue(1, undefined, 'tick')).toBeNull()
  })
})

describe('formatPrice', () => {
  test('a tick of 1 renders a whole quote whole', () => {
    expect(formatPrice(63851, market(1), 'tick')).toBe('63,851')
  })
  test('a tick never rounds away a decimal the venue actually quoted', () => {
    // Hyperliquid reports precision.price = 1 for BTC and quotes 63,978.9. A tick is a submission
    // increment, not a display rule — reading it alone put the whole order book a dollar off.
    expect(formatPrice(63978.9, market(1), 'tick')).toBe('63,978.9')
  })
  test('float noise in a computed mid does not become eight decimals', () => {
    expect(formatPrice(63982.50000000001, market(1), 'tick')).toBe('63,982.5')
  })
  test('a fractional tick renders that many decimals', () => {
    expect(formatPrice(0.12, market(0.01), 'tick')).toBe('0.12')
    // Finer than the tick claims? Then the venue quoted it, and we show it.
    expect(formatPrice(0.12345, market(0.01), 'tick')).toBe('0.12345')
  })
  test('decimals mode reads the count directly', () => {
    expect(formatPrice(12.3, market(3), 'decimals')).toBe('12.300')
  })
  test('null → em-dash', () => {
    expect(formatPrice(null)).toBe('—')
  })
})

describe('formatSize', () => {
  test('honours the amount tick, trimming trailing zeros', () => {
    expect(formatSize(1.5, market(1, 0.0001), 'tick')).toBe('1.5')
    expect(formatSize(0.0001, market(1, 0.0001), 'tick')).toBe('0.0001')
    // A size finer than the step is still a size the account holds — capped at 8 decimals, not hidden.
    expect(formatSize(0.123456789, market(1, 0.0001), 'tick')).toBe('0.12345679')
  })
})

describe('formatPercent', () => {
  test('signs and scales a fractional change', () => {
    expect(formatPercent(0.031)).toEqual({ text: '+3.10%', sign: 1 })
    expect(formatPercent(-0.02)).toEqual({ text: '-2.00%', sign: -1 })
    expect(formatPercent(0)).toEqual({ text: '0.00%', sign: 0 })
  })
  test('null → em-dash, flat sign', () => {
    expect(formatPercent(null)).toEqual({ text: '—', sign: 0 })
  })
})

describe('formatFixed', () => {
  test('renders at an exact decimal count (min = max)', () => {
    expect(formatFixed(63982.5, 1)).toBe('63,982.5')
    expect(formatFixed(63982, 0)).toBe('63,982')
    expect(formatFixed(0.074225, 6)).toBe('0.074225')
  })
  test('non-finite → em-dash', () => {
    expect(formatFixed(null, 2)).toBe('—')
    expect(formatFixed(undefined, 2)).toBe('—')
    expect(formatFixed(Number.NaN, 2)).toBe('—')
  })
  test('clamps the decimal count into [0, MAX_DECIMALS]', () => {
    expect(formatFixed(1, -3)).toBe('1')
    expect(formatFixed(1, 99)).toBe('1.00000000')
  })
})

describe('formatCompactVolume', () => {
  test('scales into K/M/B/T', () => {
    expect(formatCompactVolume(1200)).toBe('1.20K')
    expect(formatCompactVolume(3_400_000)).toBe('3.40M')
    expect(formatCompactVolume(5_600_000_000)).toBe('5.60B')
  })
  test('leaves small values plain', () => {
    expect(formatCompactVolume(42)).toBe('42')
    expect(formatCompactVolume(null)).toBe('—')
  })
})

describe('chartPriceFormat', () => {
  const mkt = (tick: number) => ({ ...market(tick) })

  test('a fractional tick drives the decimals — DOGE must not render as 0.07', () => {
    // lightweight-charts defaults to 2 decimals; we never overrode it, so every low-priced
    // market was flattened on the axis, the crosshair and every price line.
    expect(chartPriceFormat(mkt(0.000001), 'tick', [0.074026])).toEqual({
      precision: 6,
      minMove: 0.000001,
    })
  })

  test('never renders fewer decimals than the live price carries', () => {
    // Hyperliquid reports `precision.price = 1` for BTC and quotes 63982.5. A tick-derived 0
    // decimals would hide every half-dollar move.
    expect(chartPriceFormat(mkt(1), 'tick', [63982, 63982.5, 63981])).toEqual({
      precision: 1,
      minMove: 0.1,
    })
  })

  test('a whole-number price on a whole-number tick renders whole numbers', () => {
    expect(chartPriceFormat(mkt(1), 'tick', [63982, 63981])).toEqual({ precision: 0, minMove: 1 })
  })

  test('no market metadata falls back to the default price decimals', () => {
    expect(chartPriceFormat(null, 'tick', [100])).toEqual({ precision: 2, minMove: 0.01 })
  })

  test('decimals mode reads the count directly', () => {
    expect(chartPriceFormat(mkt(3), 'decimals', [12.3]).precision).toBe(3)
  })

  test('an empty price sample still yields the venue-declared decimals', () => {
    expect(chartPriceFormat(mkt(0.01), 'tick')).toEqual({ precision: 2, minMove: 0.01 })
  })
})

describe('formatFundingRate', () => {
  test("names the venue's own period — Hyperliquid funds hourly, most venues every 8h", () => {
    expect(formatFundingRate(0.0000125, '1h')).toBe('+0.00125% / 1h')
    expect(formatFundingRate(0.0001, '8h')).toBe('+0.01% / 8h')
  })

  test('a negative rate keeps its sign — shorts pay longs', () => {
    expect(formatFundingRate(-0.0000125, '1h')).toBe('-0.00125% / 1h')
  })

  test('an unreported interval is unreported, never defaulted to 8h', () => {
    expect(formatFundingRate(0.0001)).toBe('+0.01% / ?')
  })

  test('a flat rate carries no sign', () => {
    expect(formatFundingRate(0, '1h')).toBe('0% / 1h')
  })
})

describe('formatCountdown', () => {
  test('hours drop the seconds, minutes keep them', () => {
    expect(formatCountdown(3600_000 + 7 * 60_000)).toBe('1h 07m')
    expect(formatCountdown(7 * 60_000 + 12_000)).toBe('7m 12s')
    expect(formatCountdown(12_000)).toBe('12s')
  })

  test('a settlement already past has no countdown — "in 0s" is worse than nothing', () => {
    expect(formatCountdown(0)).toBeNull()
    expect(formatCountdown(-1)).toBeNull()
    expect(formatCountdown(Number.NaN)).toBeNull()
  })
})
