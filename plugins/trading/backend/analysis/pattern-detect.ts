/**
 * PURE pattern detection over OHLCV — `risk.ts` school: zero I/O, injected data, unit-tested in
 * isolation. Simple counting methods on purpose (rolling-extrema pivots, least squares, body/wick
 * ratios) — this is the entry into structured scenario analysis, not an ML oracle,
 * and every finding carries its NUMBERS so the agent can act on (or draw) it.
 *
 * The `manage_chart action:'detect'` tool renders these findings AND can auto-draw them through
 * the standard draw-command grammar (`hline` / `trendline` with stable `pat-*` ids, so a
 * re-detect REPLACES its own drawings instead of stacking new ones) — a detector that can SHOW
 * what it found beats a text-only one.
 */
import type { Candle } from '../contracts'

// ── support / resistance ────────────────────────────────────────────────────

export interface PriceLevel {
  kind: 'support' | 'resistance'
  /** The clustered level (mean of its pivot prices). */
  price: number
  /** How many pivots landed inside the cluster — the level's weight. */
  touches: number
  /** Unix seconds of the most recent touch. */
  lastTouch: number
}

export interface LevelOptions {
  /** A pivot is an extreme over ±this many bars (default 3). */
  pivotSpan?: number
  /** Pivots within this FRACTION of each other's price cluster into one level (default 0.003). */
  tolerance?: number
  /** At most this many levels per side, strongest first (default 3). */
  maxPerSide?: number
}

export interface Pivot {
  price: number
  time: number
}

/** Rolling-extrema pivots: bar `i` whose high (low) is the strict max (min) of ±span bars.
 *  Exported so divergence detection reads the SAME swing points the level clustering does. */
export function pivots(candles: Candle[], span: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = []
  const lows: Pivot[] = []
  for (let i = span; i < candles.length - span; i++) {
    const c = candles[i]!
    let isHigh = true
    let isLow = true
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue
      if (candles[j]!.high >= c.high) isHigh = false
      if (candles[j]!.low <= c.low) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) highs.push({ price: c.high, time: c.time })
    if (isLow) lows.push({ price: c.low, time: c.time })
  }
  return { highs, lows }
}

/** Cluster pivots within `tolerance` (fraction of price) into weighted levels. */
function cluster(
  points: Pivot[],
  tolerance: number,
): Array<{ price: number; touches: number; lastTouch: number }> {
  const sorted = [...points].sort((a, b) => a.price - b.price)
  const out: Array<{ price: number; touches: number; lastTouch: number }> = []
  for (const p of sorted) {
    const last = out.at(-1)
    if (last && Math.abs(p.price - last.price) <= last.price * tolerance) {
      // Running mean keeps the level centered on its touches.
      last.price = (last.price * last.touches + p.price) / (last.touches + 1)
      last.touches++
      last.lastTouch = Math.max(last.lastTouch, p.time)
    } else {
      out.push({ price: p.price, touches: 1, lastTouch: p.time })
    }
  }
  return out
}

/**
 * Support/resistance levels from clustered pivots, classified against the LAST close (a level
 * below price supports it, above resists it), strongest (most touches, then most recent) first.
 */
export function detectLevels(candles: Candle[], opts: LevelOptions = {}): PriceLevel[] {
  const span = opts.pivotSpan ?? 3
  const tolerance = opts.tolerance ?? 0.003
  const maxPerSide = opts.maxPerSide ?? 3
  if (candles.length < span * 2 + 1) return []
  const lastClose = candles.at(-1)!.close
  const { highs, lows } = pivots(candles, span)
  const levels: PriceLevel[] = [...cluster(highs, tolerance), ...cluster(lows, tolerance)].map(
    (l) => ({
      kind: l.price <= lastClose ? 'support' : 'resistance',
      price: l.price,
      touches: l.touches,
      lastTouch: l.lastTouch,
    }),
  )
  const rank = (a: PriceLevel, b: PriceLevel) => b.touches - a.touches || b.lastTouch - a.lastTouch
  return [
    ...levels
      .filter((l) => l.kind === 'support')
      .sort(rank)
      .slice(0, maxPerSide),
    ...levels
      .filter((l) => l.kind === 'resistance')
      .sort(rank)
      .slice(0, maxPerSide),
  ]
}

// ── trend ───────────────────────────────────────────────────────────────────

export interface TrendFit {
  direction: 'up' | 'down' | 'flat'
  /** Least-squares slope of the closes, as a FRACTION of the mean close per bar. */
  pctPerBar: number
  /** Fit quality 0..1 (r²) — a 0.1 r² "trend" is noise and the caller should say so. */
  r2: number
  /** The fitted line's endpoints — exactly what a trendline drawing takes. */
  start: { time: number; price: number }
  end: { time: number; price: number }
}

/** Threshold below which a per-bar drift is honestly "flat" (0.02% of price per bar). */
const FLAT_PCT_PER_BAR = 0.0002

/** Least-squares fit over the closes. Null when there are fewer than 3 bars to fit. */
export function trendFit(candles: Candle[]): TrendFit | null {
  const n = candles.length
  if (n < 3) return null
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += candles[i]!.close
  }
  const meanX = sumX / n
  const meanY = sumY / n
  let ssXY = 0
  let ssXX = 0
  let ssYY = 0
  for (let i = 0; i < n; i++) {
    const dx = i - meanX
    const dy = candles[i]!.close - meanY
    ssXY += dx * dy
    ssXX += dx * dx
    ssYY += dy * dy
  }
  if (ssXX === 0) return null
  const slope = ssXY / ssXX
  const intercept = meanY - slope * meanX
  const r2 = ssYY === 0 ? 1 : (ssXY * ssXY) / (ssXX * ssYY)
  const pctPerBar = meanY === 0 ? 0 : slope / meanY
  return {
    direction: Math.abs(pctPerBar) < FLAT_PCT_PER_BAR ? 'flat' : pctPerBar > 0 ? 'up' : 'down',
    pctPerBar,
    r2,
    start: { time: candles[0]!.time, price: intercept },
    end: { time: candles[n - 1]!.time, price: intercept + slope * (n - 1) },
  }
}

// ── market regime ─────────────────────────────────────────────────────────────

export interface MarketRegime {
  /**
   * The playbook the data supports — the exact vocabulary the analysis wizard's strategy
   * filters speak (trend-following needs `trending`, mean-reversion needs `ranging`, a
   * volatility breakout needs `compressing`).
   */
  kind: 'trending' | 'ranging' | 'compressing'
  /** 0..1 — how cleanly the data fits `kind` (the trend r² for trends, the squeeze depth for
   *  compression, the flatness for ranges). A low value means "leaning this way, not decisively". */
  confidence: number
  /** One line a human (or the agent) can read: the numbers behind the verdict. */
  note: string
}

/** A trend this clean (r²) is a real directional regime, not drift. */
const TREND_R2 = 0.5
/** Recent volatility below this fraction of the window's own typical range is a squeeze. */
const SQUEEZE_RATIO = 0.6

/** Average true range over a candle slice (Wilder's TR, simple mean) — pure, no lookback state. */
function meanTrueRange(candles: Candle[], from: number, to: number): number {
  let sum = 0
  let n = 0
  for (let i = Math.max(1, from); i < to; i++) {
    const c = candles[i]!
    const prevClose = candles[i - 1]!.close
    sum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
    n++
  }
  return n === 0 ? 0 : sum / n
}

/**
 * Classify the market regime from OHLCV + the trend fit — the single call that grounds the
 * "which playbook" decision. Order matters: a real trend wins outright; otherwise a volatility
 * squeeze (recent range well below the window's typical) flags a coiled breakout; everything
 * else is a range. Squeeze is checked over the recent QUARTER of the window against the whole,
 * the standard Bollinger-width-percentile idea expressed in ATR terms.
 */
export function classifyRegime(candles: Candle[], trend: TrendFit | null): MarketRegime | null {
  const n = candles.length
  if (n < 8) return null
  if (trend && trend.direction !== 'flat' && trend.r2 >= TREND_R2) {
    return {
      kind: 'trending',
      confidence: Math.min(1, trend.r2),
      note: `trend ${trend.direction} (r² ${trend.r2.toFixed(2)}, ${(trend.pctPerBar * 100).toFixed(3)}%/bar) — momentum regime`,
    }
  }
  const recentFrom = n - Math.max(3, Math.floor(n / 4))
  const recentAtr = meanTrueRange(candles, recentFrom, n)
  const windowAtr = meanTrueRange(candles, 0, n)
  const ratio = windowAtr === 0 ? 1 : recentAtr / windowAtr
  if (ratio <= SQUEEZE_RATIO) {
    return {
      kind: 'compressing',
      confidence: Math.min(1, (SQUEEZE_RATIO - ratio) / SQUEEZE_RATIO + 0.4),
      note: `volatility squeeze — recent range ${(ratio * 100).toFixed(0)}% of the window's typical; a coiled breakout setup`,
    }
  }
  return {
    kind: 'ranging',
    confidence: trend ? Math.min(1, 1 - trend.r2) : 0.5,
    note: `no clean trend (r² ${trend ? trend.r2.toFixed(2) : 'n/a'}), volatility normal — mean-reversion regime`,
  }
}

// ── candlestick flags ───────────────────────────────────────────────────────

export interface CandleFlag {
  pattern:
    | 'doji'
    | 'hammer'
    | 'inverted_hammer'
    | 'shooting_star'
    | 'spinning_top'
    | 'bullish_engulfing'
    | 'bearish_engulfing'
    | 'bullish_harami'
    | 'bearish_harami'
    | 'piercing_line'
    | 'dark_cloud_cover'
    | 'morning_star'
    | 'evening_star'
    | 'three_white_soldiers'
    | 'three_black_crows'
  /** Unix seconds of the bar the flag sits on (the LAST bar of a multi-bar pattern). */
  time: number
}

/**
 * Flags on the NEWEST bar / pair / triple — the fifteen classic Nison patterns (mined from the
 * Vibe-Trading candlestick engine): five single-bar, six two-bar, four three-bar. One adaptation
 * for 24/7 markets: the star patterns' "gap" is a BODY gap (the small middle body clears the
 * first bar's body), not a range gap — crypto candles almost never leave a true range gap, and
 * the strict rule would simply never fire.
 */
export function candleFlags(candles: Candle[]): CandleFlag[] {
  const c = candles.at(-1)
  if (!c) return []
  const flags: CandleFlag[] = []
  const range = c.high - c.low
  const body = Math.abs(c.close - c.open)
  const p = candles.at(-2)
  const q = candles.at(-3)
  const bodyTop = (x: Candle) => Math.max(x.open, x.close)
  const bodyBottom = (x: Candle) => Math.min(x.open, x.close)

  if (range > 0) {
    const upperWick = c.high - bodyTop(c)
    const lowerWick = bodyBottom(c) - c.low
    if (body <= range * 0.1) flags.push({ pattern: 'doji', time: c.time })
    // Hammer: long lower wick, body parked in the top third.
    else if (lowerWick >= body * 2 && bodyBottom(c) >= c.low + range * 0.6) {
      flags.push({ pattern: 'hammer', time: c.time })
    } else if (upperWick >= body * 2 && bodyTop(c) <= c.high - range * 0.6) {
      // The same shape reads by CONTEXT (Nison): after a down leg it is the bullish inverted
      // hammer, after an up leg (or with no context) the bearish shooting star.
      const downLeg = p !== undefined && q !== undefined && p.close < q.close
      flags.push({ pattern: downLeg ? 'inverted_hammer' : 'shooting_star', time: c.time })
    } else if (body < range * 0.3 && upperWick > body && lowerWick > body) {
      // Small body, real wick both sides — indecision without the doji's razor body.
      flags.push({ pattern: 'spinning_top', time: c.time })
    }
  }

  if (p) {
    const prevBody = Math.abs(p.close - p.open)
    const prevDown = p.close < p.open
    const prevUp = p.close > p.open
    const currUp = c.close > c.open
    const currDown = c.close < c.open
    // Engulfing: opposite colors, the newer body strictly containing the older one.
    if (prevBody > 0 && body > prevBody) {
      if (prevDown && currUp && c.open <= p.close && c.close >= p.open) {
        flags.push({ pattern: 'bullish_engulfing', time: c.time })
      } else if (prevUp && currDown && c.open >= p.close && c.close <= p.open) {
        flags.push({ pattern: 'bearish_engulfing', time: c.time })
      }
    }
    // Harami: a LARGE body followed by a small body fully inside it (the inside bar).
    if (prevBody > body && bodyTop(c) <= bodyTop(p) && bodyBottom(c) >= bodyBottom(p)) {
      if (prevDown) flags.push({ pattern: 'bullish_harami', time: c.time })
      else if (prevUp) flags.push({ pattern: 'bearish_harami', time: c.time })
    }
    const prevMid = (p.open + p.close) / 2
    // Piercing line: opens below the prior low, closes above the prior body's midpoint.
    if (prevDown && currUp && c.open < p.low && c.close > prevMid) {
      flags.push({ pattern: 'piercing_line', time: c.time })
    } else if (prevUp && currDown && c.open > p.high && c.close < prevMid) {
      flags.push({ pattern: 'dark_cloud_cover', time: c.time })
    }
  }

  if (p && q) {
    const d1Bear = q.close < q.open
    const d1Bull = q.close > q.open
    const d2Body = Math.abs(p.close - p.open)
    const d2Range = p.high - p.low
    const d2Small = d2Range > 0 && d2Body < d2Range * 0.3
    const d1Mid = (q.open + q.close) / 2
    // Morning/evening star — body-gap adaptation (see the function comment).
    if (d1Bear && d2Small && bodyTop(p) <= bodyBottom(q) && c.close > c.open && c.close > d1Mid) {
      flags.push({ pattern: 'morning_star', time: c.time })
    } else if (
      d1Bull &&
      d2Small &&
      bodyBottom(p) >= bodyTop(q) &&
      c.close < c.open &&
      c.close < d1Mid
    ) {
      flags.push({ pattern: 'evening_star', time: c.time })
    }
    // Three soldiers/crows: three same-color bars, closes marching, each open inside the prior body.
    const soldiers =
      d1Bull &&
      p.close > p.open &&
      c.close > c.open &&
      p.close > q.close &&
      c.close > p.close &&
      p.open >= q.open &&
      p.open <= q.close &&
      c.open >= p.open &&
      c.open <= p.close
    const crows =
      d1Bear &&
      p.close < p.open &&
      c.close < c.open &&
      p.close < q.close &&
      c.close < p.close &&
      p.open <= q.open &&
      p.open >= q.close &&
      c.open <= p.open &&
      c.open >= p.close
    if (soldiers) flags.push({ pattern: 'three_white_soldiers', time: c.time })
    else if (crows) flags.push({ pattern: 'three_black_crows', time: c.time })
  }
  return flags
}

// ── the aggregate report ────────────────────────────────────────────────────

export interface PatternReport {
  levels: PriceLevel[]
  trend: TrendFit | null
  regime: MarketRegime | null
  flags: CandleFlag[]
}

export function detectPatterns(candles: Candle[], opts: LevelOptions = {}): PatternReport {
  const trend = trendFit(candles)
  return {
    levels: detectLevels(candles, opts),
    trend,
    regime: classifyRegime(candles, trend),
    flags: candleFlags(candles),
  }
}
