import { useEffect, useState } from 'react'
import type { Candle } from '../../backend/contracts'
import { tradingApi } from '../api/tradingApi'
import { computeTechnicalRatings, type RatingVerdict } from './technicalRatings'

/**
 * The summary verdict PER TIMEFRAME — the strip above the Technicals tables, so one glance says
 * whether the timeframes agree (trading with the higher-timeframe trend is the single most
 * repeated edge in the literature; a 5m BUY under a 1d STRONG SELL is a countertrend scalp and
 * should read like one). One bounded fetch per timeframe when the page opens (or the market
 * changes) — no polling, no streams; the active timeframe's own gauge stays the live source of
 * truth, this strip is the cross-check.
 */

/** Enough bars to warm the 200-period moving averages the rating votes on. */
const VERDICT_BARS = 260

/** Session cache with a short TTL: re-mounting the page (tab switches unmount it) repaints the
 *  strip instantly and skips the five refetches while the entries are fresh. A verdict is a
 *  smoothed aggregate — minutes-old is as good as live for a cross-timeframe alignment glance. */
const VERDICT_TTL_MS = 120_000
const verdictCache = new Map<string, { verdict: RatingVerdict; at: number }>()

const cacheKey = (connectionId: string, symbol: string, timeframe: string): string =>
  `${connectionId}/${symbol}/${timeframe}`

/**
 * Publish a verdict a surface ALREADY computed, so the strip does not re-fetch what is on
 * screen. The Technicals page holds the active timeframe's full rating — the very same
 * `computeTechnicalRatings` call this hook would make — so paying for a second read of those
 * candles buys nothing but a slot in the venue's serial rate limiter, which the visible chart
 * is queuing behind (see the measurement in `TradingChartTab`).
 */
export function publishTimeframeVerdict(
  connectionId: string,
  symbol: string,
  timeframe: string,
  verdict: RatingVerdict,
): void {
  verdictCache.set(cacheKey(connectionId, symbol, timeframe), { verdict, at: Date.now() })
}

export type TimeframeVerdicts = Partial<Record<string, RatingVerdict>>

export function useTimeframeVerdicts(
  connectionId: string,
  symbol: string,
  timeframes: readonly string[],
  /** False parks the hook (no fetches) — for surfaces that only need the strip while open, and
   *  for holding the five background reads back until the PRIMARY one has landed. */
  enabled = true,
): TimeframeVerdicts {
  // `timeframes` is a module-level constant at the call site; joined so the dep is a value.
  const key = timeframes.join(',')
  const [verdicts, setVerdicts] = useState<TimeframeVerdicts>(() =>
    seedFromCache(connectionId, symbol, key),
  )

  // A market change always clears — even while parked (enabled=false), so a re-open can never
  // paint one frame of the PREVIOUS market's dots before the fetch effect fills them in. Like the
  // seeding below, it happens while rendering: a reset effect would paint that frame first.
  const market = `${connectionId}/${symbol}`
  const [seenMarket, setSeenMarket] = useState(market)
  if (seenMarket !== market) {
    setSeenMarket(market)
    setVerdicts({})
  }
  // Entering a run (first enable, or a changed market/timeframe set) paints what the cache still
  // holds; parking forgets the run, so a re-enable seeds again.
  const run = `${market}/${key}`
  const [seededRun, setSeededRun] = useState<string | null>(enabled ? run : null)
  if (enabled && seededRun !== run) {
    setSeededRun(run)
    setVerdicts(seedFromCache(connectionId, symbol, key))
  } else if (!enabled && seededRun !== null) {
    setSeededRun(null)
  }

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const seeded = seedFromCache(connectionId, symbol, key)
    for (const tf of key.split(',')) {
      if (seeded[tf] !== undefined) continue // fresh in cache — skip the fetch entirely
      tradingApi
        .ohlcv(connectionId, symbol, { timeframe: tf, limit: VERDICT_BARS })
        .then((candles: Candle[]) => {
          const verdict = computeTechnicalRatings(candles)?.summary.verdict
          if (!verdict) return
          verdictCache.set(cacheKey(connectionId, symbol, tf), { verdict, at: Date.now() })
          if (alive) setVerdicts((prev) => ({ ...prev, [tf]: verdict }))
        })
        // A venue without this timeframe (or a failed read) simply leaves the chip empty.
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [connectionId, symbol, key, enabled])

  return verdicts
}

function seedFromCache(connectionId: string, symbol: string, key: string): TimeframeVerdicts {
  const out: TimeframeVerdicts = {}
  const now = Date.now()
  for (const tf of key.split(',')) {
    const hit = verdictCache.get(cacheKey(connectionId, symbol, tf))
    if (hit && now - hit.at < VERDICT_TTL_MS) out[tf] = hit.verdict
  }
  return out
}
