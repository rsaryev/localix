import { describe, expect, test } from 'bun:test'
import {
  normalizeCandle,
  normalizeCandles,
  normalizeFundingPayment,
  normalizeFundingPayments,
  normalizeFundingRate,
  normalizeMarket,
  normalizeOpenInterest,
  normalizeOrderBook,
  normalizeTicker,
  normalizeTrade,
  num,
} from './normalize'

describe('num', () => {
  test('coerces numeric strings', () => {
    expect(num('1.5')).toBe(1.5)
    expect(num('  42  ')).toBe(42)
  })
  test('rejects junk/NaN/Infinity/blank', () => {
    expect(num('abc')).toBeUndefined()
    expect(num('')).toBeUndefined()
    expect(num('   ')).toBeUndefined()
    expect(num(Number.NaN)).toBeUndefined()
    expect(num(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(num(null)).toBeUndefined()
    expect(num(undefined)).toBeUndefined()
    expect(num({})).toBeUndefined()
  })
  test('passes finite numbers through', () => {
    expect(num(3)).toBe(3)
    expect(num(0)).toBe(0)
  })
})

describe('normalizeMarket: operator', () => {
  const market = (over: Record<string, unknown> = {}) => ({
    symbol: 'X/USDC',
    base: 'X',
    quote: 'USDC',
    ...over,
  })

  // Hyperliquid lists AAPL four times: once itself, and once per third-party "builder dex", on
  // different quote currencies with different liquidity. Two rows reading `AAPL` are two different
  // instruments, so the operator travels with the market.
  test('a third-party market carries the operator the venue flagged', () => {
    const m = normalizeMarket(
      market({ symbol: 'XYZ-AAPL/USDC:USDC', base: 'XYZ-AAPL', info: { hip3: true } }),
    )
    expect(m?.operator).toBe('XYZ')
  })

  test("the exchange's own market has no operator — absent, not an empty string", () => {
    const m = normalizeMarket(market({ symbol: 'AAPL/USDC', base: 'AAPL', info: { hip3: false } }))
    expect(m?.operator).toBeUndefined()
    expect('operator' in (m as object)).toBe(false)
  })

  // The FLAG licenses reading the prefix. A hyphen alone proves nothing: `ZM-USDC` is an ordinary
  // market whose base is `ZM`, and tagging it as `ZM`-operated would libel a real market.
  test('a hyphen without the flag is never read as an operator', () => {
    expect(normalizeMarket(market({ symbol: 'ZM-USDC', base: 'ZM' }))?.operator).toBeUndefined()
    expect(normalizeMarket(market({ symbol: 'A-B/USDC', base: 'A-B' }))?.operator).toBeUndefined()
  })

  test('a flagged market whose base carries no prefix reports no operator rather than itself', () => {
    expect(
      normalizeMarket(market({ base: 'AAPL', info: { hip3: true } }))?.operator,
    ).toBeUndefined()
  })

  // Hyperliquid STATES the deployer in `info.dex`. Prefer it: parsing the base's prefix is lossy —
  // a token whose own name carries a hyphen hands back the wrong half — and it invents a value the
  // venue already gave us.
  test('the stated dex wins over the prefix parsed from the base', () => {
    const m = normalizeMarket(
      market({ symbol: 'XYZ-AAPL/USDC:USDC', base: 'XYZ-AAPL', info: { hip3: true, dex: 'xyz' } }),
    )
    expect(m?.operator).toBe('xyz')
  })

  test('a stated dex names an operator even where the base has no prefix to parse', () => {
    expect(
      normalizeMarket(market({ base: 'AAPL', info: { hip3: true, dex: 'km' } }))?.operator,
    ).toBe('km')
  })

  test('a stated dex without the flag is still no operator', () => {
    expect(normalizeMarket(market({ base: 'AAPL', info: { dex: 'km' } }))?.operator).toBeUndefined()
  })

  test('a venue that reports no info at all has no operator', () => {
    expect(normalizeMarket(market())?.operator).toBeUndefined()
  })
})

describe('normalizeMarket', () => {
  test('carries the contract size and linearity the venue states', () => {
    const m = normalizeMarket({
      symbol: 'BTC/USDT:USDT',
      base: 'BTC',
      quote: 'USDT',
      type: 'swap',
      contract: true,
      contractSize: 0.01,
      linear: true,
    })
    expect(m).toMatchObject({ contract: true, contractSize: 0.01, linear: true })
  })

  test('a spot market carries neither — they are contract facts', () => {
    const m = normalizeMarket({
      symbol: 'BTC/USDT',
      base: 'BTC',
      quote: 'USDT',
      type: 'spot',
      contract: false,
      contractSize: 1,
      linear: true,
    })
    expect(m?.contractSize).toBeUndefined()
    expect(m?.linear).toBeUndefined()
  })

  test('a contract market the venue did not size or classify gets nothing invented', () => {
    // `1` is a claim about size, and `linear` a claim about what a contract settles in. Absent, an
    // order on this market cannot be valued at all — which the risk gate turns into a refusal.
    const m = normalizeMarket({
      symbol: 'X/USDT:USDT',
      base: 'X',
      quote: 'USDT',
      type: 'swap',
      contract: true,
    })
    expect(m?.contractSize).toBeUndefined()
    expect(m?.linear).toBeUndefined()
  })

  test('drops an entry missing a required field', () => {
    expect(normalizeMarket(null)).toBeNull()
    expect(normalizeMarket({})).toBeNull()
    expect(normalizeMarket({ symbol: 'BTC/USDT', base: 'BTC' })).toBeNull() // no quote
  })

  test('normalizes a full ccxt market shape, coercing numeric-string precision/limits', () => {
    const m = normalizeMarket({
      symbol: 'BTC/USDT',
      base: 'BTC',
      quote: 'USDT',
      type: 'spot',
      active: true,
      contract: false,
      precision: { price: '0.01', amount: '0.0001' },
      limits: { amount: { min: '0.0001' }, cost: { min: '5' }, leverage: { max: '10' } },
    })
    expect(m).toEqual({
      symbol: 'BTC/USDT',
      base: 'BTC',
      quote: 'USDT',
      type: 'spot',
      active: true,
      contract: false,
      precision: { price: 0.01, amount: 0.0001 },
      limits: { minAmount: 0.0001, minCost: 5, maxLeverage: 10 },
    })
  })

  test('an omitted `active` flag means tradable (ccxt semantics)', () => {
    expect(normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B' })?.active).toBe(true)
    expect(normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B', active: false })?.active).toBe(
      false,
    )
  })

  test('carries the venue-reported maker/taker fee rates (coercing numeric strings)', () => {
    // Verified live: Hyperliquid populates both on every market (perp maker 0.00015 / taker 0.00045).
    expect(
      normalizeMarket({
        symbol: 'BTC/USDC:USDC',
        base: 'BTC',
        quote: 'USDC',
        maker: 0.00015,
        taker: 0.00045,
      })?.fees,
    ).toEqual({
      maker: 0.00015,
      taker: 0.00045,
    })
    expect(
      normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B', maker: '0.0004', taker: '0.0007' })
        ?.fees,
    ).toEqual({
      maker: 0.0004,
      taker: 0.0007,
    })
  })

  test('omits `fees` entirely when the venue reported no rate — an absent fee is not a zero fee', () => {
    expect(normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B' })?.fees).toBeUndefined()
    // A junk rate coerces to undefined, and a market with only junk carries no `fees` object.
    expect(
      normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B', maker: 'n/a', taker: null })?.fees,
    ).toBeUndefined()
  })

  test('carries a lone maker OR taker rate without inventing the other', () => {
    expect(normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B', taker: 0.001 })?.fees).toEqual({
      maker: undefined,
      taker: 0.001,
    })
  })

  test('falls back to swap for an unrecognized type on a contract market, else spot', () => {
    expect(
      normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B', type: 'bogus', contract: true })
        ?.type,
    ).toBe('swap')
    expect(
      normalizeMarket({ symbol: 'A/B', base: 'A', quote: 'B', type: 'bogus', contract: false })
        ?.type,
    ).toBe('spot')
  })
})

describe('normalizeTicker', () => {
  test('drops when no symbol is derivable', () => {
    expect(normalizeTicker({})).toBeNull()
    expect(normalizeTicker(null)).toBeNull()
  })

  test('falls back to the caller-supplied symbol when the venue omits it', () => {
    expect(normalizeTicker({ last: 100 }, 'BTC/USDT')?.symbol).toBe('BTC/USDT')
  })

  test('converts ccxt `percentage` (a percent) into a fraction', () => {
    const t = normalizeTicker({ symbol: 'BTC/USDT', percentage: 3.1 })
    expect(t?.change).toBeCloseTo(0.031)
  })

  test('omits `change` when percentage is absent, and falls back to `close` for `last`', () => {
    const t = normalizeTicker({ symbol: 'BTC/USDT', close: 42 })
    expect(t?.change).toBeUndefined()
    expect(t?.last).toBe(42)
  })
})

describe('normalizeCandle / normalizeCandles', () => {
  test('drops a bar missing any OHLC value', () => {
    expect(normalizeCandle([1000, 1, 2])).toBeNull() // too short
    expect(normalizeCandle([1000, 1, 2, undefined, 4, 5])).toBeNull()
    expect(normalizeCandle('not an array')).toBeNull()
  })

  test('converts ms to unix seconds', () => {
    const c = normalizeCandle([1_700_000_000_000, 1, 2, 0.5, 1.5, 7])
    expect(c).toEqual({ time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 7 })
  })

  test('a bar with no volume is UNKNOWN, never a bar in which nothing traded', () => {
    // `0` draws a zero-height column that is indistinguishable from a silent bar, and a window of
    // such bars sums to a stated 24h volume of zero — a claim that nobody trades this market.
    expect(normalizeCandle([1_700_000_000_000, 1, 2, 0.5, 1.5])?.volume).toBeUndefined()
  })

  test('a REPORTED zero-volume bar is a real bar in which nothing traded', () => {
    expect(normalizeCandle([1_700_000_000_000, 1, 2, 0.5, 1.5, 0])?.volume).toBe(0)
  })

  test('de-dupes by timestamp (later entry wins) and sorts ascending', () => {
    const out = normalizeCandles([
      [3000, 1, 1, 1, 1, 1],
      [1000, 2, 2, 2, 2, 2],
      [3000, 9, 9, 9, 9, 9], // repeat of the in-progress bar — later one wins
      [2000, 3, 3, 3, 3, 3],
    ])
    expect(out.map((c) => c.time)).toEqual([1, 2, 3])
    expect(out.find((c) => c.time === 3)?.open).toBe(9)
  })

  test('non-array input yields an empty list', () => {
    expect(normalizeCandles(null)).toEqual([])
    expect(normalizeCandles({})).toEqual([])
  })
})

describe('normalizeOrderBook', () => {
  test('honours a limit and skips malformed levels', () => {
    const ob = normalizeOrderBook(
      {
        bids: [[100, 1], ['not a row'], [99, 2], [98, 3]],
        asks: [[101, 1]],
      },
      'BTC/USDT',
      2,
    )
    expect(ob.bids).toEqual([
      [100, 1],
      [99, 2],
    ])
    expect(ob.asks).toEqual([[101, 1]])
  })

  test('drops a level with a non-numeric price or amount', () => {
    const ob = normalizeOrderBook(
      {
        bids: [
          [100, 'x'],
          ['y', 1],
          [99, 1],
        ],
        asks: [],
      },
      'BTC/USDT',
    )
    expect(ob.bids).toEqual([[99, 1]])
  })

  test('falls back to the caller symbol and empty arrays; an unstamped snapshot stays UNDATED', () => {
    const ob = normalizeOrderBook(null, 'ETH/USDT')
    expect(ob).toEqual({ symbol: 'ETH/USDT', timestamp: undefined, bids: [], asks: [] })
  })
})

describe('normalizeTrade', () => {
  test('drops when price or amount is missing', () => {
    expect(normalizeTrade({ price: 1 })).toBeNull()
    expect(normalizeTrade({ amount: 1 })).toBeNull()
  })
  test('defaults side to buy for anything other than sell', () => {
    expect(normalizeTrade({ price: 1, amount: 1 })?.side).toBe('buy')
    expect(normalizeTrade({ price: 1, amount: 1, side: 'sell' })?.side).toBe('sell')
    expect(normalizeTrade({ price: 1, amount: 1, side: 'bogus' })?.side).toBe('buy')
  })
})

describe('the venue reports the price 24h ago and ccxt drops it', () => {
  // Verified live against Hyperliquid: fetchTicker('BTC/USDC:USDC') returns
  // { last: 63878.5, previousClose: 62855, percentage: undefined }. ccxt's `safeTicker` derives
  // `percentage` from the `open` key only, and HL reports `prevDayPx` → `previousClose`, so the
  // 24h change came out undefined and every consumer measured the candle window instead.
  test('a change is derived from previousClose when the venue reports no percentage', () => {
    const t = normalizeTicker({ symbol: 'BTC/USDC:USDC', last: 63878.5, previousClose: 62855 })
    expect(t?.previousClose).toBe(62855)
    expect(t?.change).toBeCloseTo((63878.5 - 62855) / 62855, 9)
  })

  test("the venue's own percentage wins — it is the venue's stat, not our arithmetic", () => {
    const t = normalizeTicker({ symbol: 'X', last: 110, previousClose: 100, percentage: 5 })
    expect(t?.change).toBe(0.05)
  })

  test('a zero or absent previousClose derives nothing — never a division by zero', () => {
    expect(normalizeTicker({ symbol: 'X', last: 110, previousClose: 0 })?.change).toBeUndefined()
    expect(normalizeTicker({ symbol: 'X', last: 110 })?.change).toBeUndefined()
    expect(normalizeTicker({ symbol: 'X', previousClose: 100 })?.change).toBeUndefined()
  })

  test('a flat day is a change of zero, not an absent change', () => {
    expect(normalizeTicker({ symbol: 'X', last: 100, previousClose: 100 })?.change).toBe(0)
  })
})

describe('a funding rate means nothing without its interval', () => {
  // Verified live: Hyperliquid funds HOURLY at 0.0000125 and reports interval '1h'. Most venues
  // fund every 8h. The reflex "×3 for the daily cost" overstates Hyperliquid by a factor of eight.
  test('the interval is carried verbatim, never defaulted', () => {
    const f = normalizeFundingRate({
      symbol: 'BTC/USDC:USDC',
      fundingRate: 0.0000125,
      interval: '1h',
      markPrice: 63877,
      indexPrice: 63871,
    })
    expect(f).toMatchObject({
      symbol: 'BTC/USDC:USDC',
      rate: 0.0000125,
      interval: '1h',
      markPrice: 63877,
      indexPrice: 63871,
    })
  })

  test('an unreported interval stays absent — we do not assume 8h', () => {
    expect(normalizeFundingRate({ symbol: 'X', fundingRate: 0.0001 })?.interval).toBeUndefined()
  })

  test('a missing rate is no funding rate at all — never 0, which reads as "free to hold"', () => {
    expect(normalizeFundingRate({ symbol: 'X' })).toBeNull()
    expect(normalizeFundingRate({ symbol: 'X', fundingRate: 'abc' })).toBeNull()
  })

  test('a genuine zero rate is a rate', () => {
    expect(normalizeFundingRate({ symbol: 'X', fundingRate: 0 })?.rate).toBe(0)
  })

  test('the settlement carried is the one THIS rate applies to — ccxt `fundingTimestamp`', () => {
    // `nextFundingTimestamp` is the settlement AFTER the rate on screen (okx pairs it with its own
    // `nextFundingRate`). Preferring it counted the header's countdown down to a moment one whole
    // funding interval past the rate it sits beside.
    expect(
      normalizeFundingRate({
        symbol: 'X',
        fundingRate: 1,
        fundingTimestamp: 1,
        nextFundingTimestamp: 2,
      })?.nextFundingTime,
    ).toBe(1)
  })

  test('a venue that reports only the LATER settlement still gets a countdown', () => {
    expect(
      normalizeFundingRate({ symbol: 'X', fundingRate: 1, nextFundingTimestamp: 2 })
        ?.nextFundingTime,
    ).toBe(2)
  })

  test('a venue that reports no settlement time gets none invented', () => {
    expect(normalizeFundingRate({ symbol: 'X', fundingRate: 1 })?.nextFundingTime).toBeUndefined()
  })
})

describe('open interest is reported, never derived', () => {
  test('a venue-reported amount is carried; an absent quote value is not invented', () => {
    // Live: Hyperliquid reports openInterestAmount only. `amount × price` would state a quote
    // figure the venue never gave, at whatever price we happened to be holding.
    const oi = normalizeOpenInterest({ symbol: 'BTC/USDC:USDC', openInterestAmount: 37171.75828 })
    expect(oi).toMatchObject({ symbol: 'BTC/USDC:USDC', amount: 37171.75828 })
    expect(oi?.value).toBeUndefined()
  })

  test('neither amount nor value is no open interest at all', () => {
    expect(normalizeOpenInterest({ symbol: 'X' })).toBeNull()
  })
})

describe('normalizeFundingPayment', () => {
  // Shape drawn from the LIVE Hyperliquid probe (ccxt 4.5.64 funding-history structure):
  //   { symbol, code: 'USDC', amount, rate, timestamp, id, info }
  test('maps ccxt funding history verbatim — sign preserved (+ received, - paid), code → currency', () => {
    const paid = normalizeFundingPayment({
      symbol: 'BTC/USDC:USDC',
      code: 'USDC',
      amount: -0.495094,
      rate: 0.0000125,
      timestamp: 1783670400011,
    })
    expect(paid).toEqual({
      symbol: 'BTC/USDC:USDC',
      amount: -0.495094,
      currency: 'USDC',
      rate: 0.0000125,
      timestamp: 1783670400011,
    })
    const received = normalizeFundingPayment({
      symbol: 'CFX/USDC:USDC',
      code: 'USDC',
      amount: 0.019673,
      rate: 0.0000125,
      timestamp: 1,
    })
    expect(received?.amount).toBe(0.019673) // NOT flipped — positive stays positive (received)
  })

  test('coerces numeric strings and falls back to the symbol', () => {
    const f = normalizeFundingPayment({ amount: '-0.4', rate: '0.0000125' }, 'ETH/USDC:USDC')
    expect(f).toMatchObject({ symbol: 'ETH/USDC:USDC', amount: -0.4, rate: 0.0000125 })
    expect(f?.currency).toBeUndefined()
  })

  test('a settlement with no readable amount is DROPPED (absent, never a zero payment)', () => {
    // The amount IS the payment; an unreadable one tells us nothing, like a fill with no price.
    expect(normalizeFundingPayment({ symbol: 'X', code: 'USDC' })).toBeNull()
    expect(normalizeFundingPayment({ symbol: 'X', amount: 'nope' })).toBeNull()
    expect(normalizeFundingPayment({ amount: -1 })).toBeNull() // no symbol, no fallback
  })

  test('normalizeFundingPayments maps + filters the array, keeping order', () => {
    const rows = normalizeFundingPayments([
      { symbol: 'A', amount: 1, code: 'USDC' },
      { symbol: 'B' }, // unreadable amount → dropped
      { symbol: 'C', amount: -2, code: 'USDC' },
    ])
    expect(rows.map((r) => [r.symbol, r.amount])).toEqual([
      ['A', 1],
      ['C', -2],
    ])
    expect(normalizeFundingPayments('not an array')).toEqual([])
  })
})
