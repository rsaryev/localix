/**
 * Public market-data feed normalizers: tickers, candles, order books and the public trade tape.
 * Pure — see `normalize.ts` for the module-family discipline (untrusted input, nothing throws,
 * a missing required field drops the entry).
 */
import type { Candle, OrderBook, OrderBookLevel, PublicTrade, Ticker } from './contracts'
import { num, str } from './normalize-scalars'

export function normalizeTicker(raw: unknown, fallbackSymbol?: string): Ticker | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const symbol = str(t.symbol) ?? fallbackSymbol
  if (!symbol) return null
  // `percentage` is a PERCENT (3.1); the contract wants a fraction (0.031).
  const percentage = num(t.percentage)
  const last = num(t.last) ?? num(t.close)
  const previousClose = num(t.previousClose)

  // ccxt derives `percentage` from `open`, and `safeTicker` reads ONLY the `open` key. Hyperliquid
  // reports no `open` — it reports `prevDayPx`, which its parser hands to `previousClose`, where
  // ccxt then ignores it. So the venue tells us the price 24h ago and the 24h change comes out
  // `undefined`, and every consumer fell back to measuring the candle window instead. Take the
  // venue's own number: `previousClose` is 24h by definition, the candles are however far they reach.
  const fromPreviousClose =
    previousClose !== undefined && previousClose > 0 && last !== undefined
      ? (last - previousClose) / previousClose
      : undefined

  return {
    symbol,
    timestamp: num(t.timestamp),
    last,
    bid: num(t.bid),
    ask: num(t.ask),
    high: num(t.high),
    low: num(t.low),
    baseVolume: num(t.baseVolume),
    quoteVolume: num(t.quoteVolume),
    change: percentage === undefined ? fromPreviousClose : percentage / 100,
    previousClose,
  }
}

/**
 * `[ms, open, high, low, close, volume]` → a `Candle` with `time` in UNIX SECONDS (the
 * unit charting libraries index on). A bar missing any OHLC value is dropped; a bar missing its
 * VOLUME keeps `volume: undefined` — `0` says nothing traded in that bar, and a window of such
 * bars sums to a day's volume of zero, which reads as a market nobody trades.
 */
export function normalizeCandle(raw: unknown): Candle | null {
  if (!Array.isArray(raw) || raw.length < 5) return null
  const [ms, o, h, l, c, v] = raw
  const time = num(ms)
  const open = num(o)
  const high = num(h)
  const low = num(l)
  const close = num(c)
  if (
    time === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined
  )
    return null
  return { time: Math.floor(time / 1000), open, high, low, close, volume: num(v) }
}

/** Sorted, de-duplicated by timestamp (a venue may repeat the in-progress bar). */
export function normalizeCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return []
  const byTime = new Map<number, Candle>()
  for (const row of raw) {
    const c = normalizeCandle(row)
    if (c) byTime.set(c.time, c)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

function normalizeLevels(raw: unknown, limit?: number): OrderBookLevel[] {
  if (!Array.isArray(raw)) return []
  const out: OrderBookLevel[] = []
  for (const row of raw) {
    if (!Array.isArray(row)) continue
    const price = num(row[0])
    const amount = num(row[1])
    if (price === undefined || amount === undefined) continue
    out.push([price, amount])
    if (limit !== undefined && out.length >= limit) break
  }
  return out
}

export function normalizeOrderBook(raw: unknown, symbol: string, limit?: number): OrderBook {
  const b = (raw ?? {}) as Record<string, unknown>
  return {
    symbol: str(b.symbol) ?? symbol,
    timestamp: num(b.timestamp),
    bids: normalizeLevels(b.bids, limit),
    asks: normalizeLevels(b.asks, limit),
  }
}

export function normalizeTrade(raw: unknown): PublicTrade | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const price = num(t.price)
  const amount = num(t.amount)
  if (price === undefined || amount === undefined) return null
  return {
    id: str(t.id),
    timestamp: num(t.timestamp),
    price,
    amount,
    side: t.side === 'sell' ? 'sell' : 'buy',
  }
}
