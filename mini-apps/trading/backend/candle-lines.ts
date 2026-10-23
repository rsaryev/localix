import { maCrossBias, movingAverages } from './candle-analytics'

/**
 * Pure one-line candle-window renderers shared by the `market_data` agent tool AND the `localix://resource/trade`
 * candles resource-leaf. ONE renderer, two surfaces: a market dragged into chat reads the same
 * window trend and moving-average bias the agent reasons from, so the two can never drift.
 *
 * Structural over the fields it needs, so both the tool's `MarketDataCandle` and the driver's
 * `Candle` satisfy it without a conversion.
 */
export interface CandleLike {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

/**
 * A one-line summary of the candle window: its open→close move (with direction and percent) and its
 * high/low. The raw bars follow, but an agent (or a reader of a linked market) should not have to
 * parse thirty rows to see that the window rose — the summary states the trend the bars only imply.
 * `null` on an empty window. The percent is omitted (not `0%`) when the first open is `0`, which no
 * real market reports.
 */
export function candleSummary(candles: CandleLike[], timeframe: string): string | null {
  if (candles.length === 0) return null
  const first = candles[0]!
  const last = candles[candles.length - 1]!
  let high = first.high
  let low = first.low
  for (const k of candles) {
    if (k.high > high) high = k.high
    if (k.low < low) low = k.low
  }
  const open = first.open
  const close = last.close
  const dir = close > open ? '▲' : close < open ? '▼' : '='
  const chg =
    open !== 0
      ? ` ${((close - open) / open) * 100 >= 0 ? '+' : ''}${(((close - open) / open) * 100).toFixed(2)}%`
      : ''
  return `  window (${candles.length}×${timeframe}): O ${open} → C ${close} ${dir}${chg} · H ${high} L ${low}`
}

/**
 * The moving-average trend read — the SAME MA20/MA50 pair the chart overlays, given as numbers
 * instead of a line, so the figure the human reads off the chart is the figure the agent (or a
 * linked market view) reasons from. States each trailing average, the fast/slow crossover bias, and
 * where the last price sits relative to the fast average.
 *
 * Honest about the window: a default candle count too short for MA50 names the slow period as unmet
 * and asserts NO bias (`maCrossBias` returns `null` — "unknown" must never render as "flat"). Returns
 * `null` only when neither average can be computed (an empty or very short window).
 */
export function trendLine(
  candles: CandleLike[],
  price: number | undefined,
  periods: readonly [number, number] = [20, 50],
): string | null {
  const closes = candles.map((c) => c.close)
  const [fast, slow] = movingAverages(closes, [periods[0], periods[1]])
  if (fast!.value === null && slow!.value === null) return null
  const trim = (n: number) => n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
  const parts: string[] = []
  parts.push(
    fast!.value !== null
      ? `MA${fast!.period} ${trim(fast!.value)}`
      : `MA${fast!.period} needs ≥${fast!.period} candles`,
  )
  parts.push(
    slow!.value !== null
      ? `MA${slow!.period} ${trim(slow!.value)}`
      : `MA${slow!.period} needs ≥${slow!.period} candles`,
  )
  const bias = maCrossBias(fast!.value, slow!.value)
  const biasNote = bias
    ? ` — ${bias} (MA${fast!.period} ${bias === 'bullish' ? '>' : bias === 'bearish' ? '<' : '='} MA${slow!.period})`
    : ''
  // Where the last price sits vs the fast average, WITH the magnitude — a price stretched far above
  // MA20 is overextended, one hugging it is trending calmly; the direction alone doesn't say which.
  // Only when the average is a real positive number (division), else the qualitative note is dropped.
  const priceNote =
    price !== undefined && fast!.value !== null && fast!.value > 0
      ? (() => {
          const where = price > fast!.value ? 'above' : price < fast!.value ? 'below' : 'at'
          const mag =
            where === 'at'
              ? ''
              : ` by ${((Math.abs(price - fast!.value) / fast!.value) * 100).toFixed(2)}%`
          return ` · price ${where} MA${fast!.period}${mag}`
        })()
      : ''
  return `  trend: ${parts.join(' vs ')}${biasNote}${priceNote}`
}
