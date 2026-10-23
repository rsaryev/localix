import type { Candle } from '../../backend/contracts'
import type { LineData } from 'lightweight-charts'
import {
  adx,
  ao,
  bullBearPower,
  cci,
  elderRay,
  ema,
  hma,
  ichimoku,
  macd,
  momentum,
  rsi,
  stoch,
  stochRsi,
  ultimateOscillator,
  vwma,
  williamsR,
} from './indicators'
import {
  adxVote,
  aoVote,
  bullBearVote,
  cciVote,
  ichimokuVote,
  macdVote,
  maVote,
  momentumVote,
  rsiVote,
  stochRsiVote,
  stochVote,
  ultimateVote,
  williamsVote,
  type RatingAction,
} from './ratingRules'

/**
 * TECHNICAL RATINGS — the full "Technicals" table: eleven oscillators and
 * fifteen moving averages, each voting buy / sell / neutral by its classic textbook rule, plus
 * the three aggregate gauges (Oscillators / Summary / Moving Averages).
 *
 * Same discipline as the rest of the analysis layer: every vote CITES its value, a rule that
 * cannot decide abstains (`neutral`), and an indicator whose warm-up the window cannot cover
 * reports `null` rather than a fabricated number. The rules are the standard published ones
 * (an oscillator votes at its extreme with a direction confirm; a moving average votes by which
 * side of it price closed) — deterministic and inspectable, not a black box.
 *
 * EVERY rule below implements the published technical-rating methodology. Where its summary prose
 * is ambiguous, the rule uses the indicator's complete signal conditions; for example, Bull/Bear Power evaluates its two
 * Elder-Ray components against the trend. The rules themselves live in `ratingRules.ts` as pure
 * functions, each pinned by a test table — a drift from the published methodology fails a test
 * rather than quietly changing what the gauge tells a trader to do. THIS file supplies the values
 * and does the counting.
 *
 * Why match a published methodology at all: the gauge's number is only meaningful if it means
 * the SAME thing everywhere it is read. Localix-specific lenses (structure, VWAP, value area,
 * funding, smart money) live beside the tables in the Technicals tab — they are additions, never
 * silent edits to the standard vote.
 */

export type { RatingAction }

export interface RatingRow {
  name: string
  /** The indicator's latest value (what the table prints), or null when not computable. */
  value: number | null
  /** The vote, or null when the indicator could not be computed over this window. */
  action: RatingAction | null
}

export type RatingVerdict = 'strong_sell' | 'sell' | 'neutral' | 'buy' | 'strong_buy'

export interface RatingGroup {
  rows: RatingRow[]
  buys: number
  sells: number
  neutrals: number
  /** `(buys − sells) / voted`, −1..1. Null when nothing voted. */
  score: number | null
  verdict: RatingVerdict
}

export interface TechnicalRatings {
  oscillators: RatingGroup
  movingAverages: RatingGroup
  /** Pooled counts, but score/verdict = MEAN of the two group scores (the published methodology —
   *  a pool would let the 15 MAs outvote the 11 oscillators). */
  summary: RatingGroup
}

export type RatingSort = 'standard' | 'signal'

/** Table order: 'standard' keeps the canonical published order; 'signal' groups buys first, then
 *  neutral, sell, and non-voting last — stable within each band, so scanning stays predictable. */
export function sortRatingRows(rows: readonly RatingRow[], sort: RatingSort): RatingRow[] {
  if (sort === 'standard') return [...rows]
  const rank = (a: RatingAction | null): number =>
    a === 'buy' ? 0 : a === 'neutral' ? 1 : a === 'sell' ? 2 : 3
  return [...rows].sort((a, b) => rank(a.action) - rank(b.action))
}

/**
 * The published gauge bands, with the boundaries where the source puts them: neutral is the
 * CLOSED interval [−0.1, 0.1], buy is (0.1, 0.5], strong buy is (0.5, 1]. A score of exactly
 * 0.1 is neutral, not buy — the band edges belong to the calmer verdict.
 */
export function verdictOf(score: number | null): RatingVerdict {
  if (score === null) return 'neutral'
  if (score > 0.5) return 'strong_buy'
  if (score > 0.1) return 'buy'
  if (score < -0.5) return 'strong_sell'
  if (score < -0.1) return 'sell'
  return 'neutral'
}

const last = (s: LineData[]): number | null => s.at(-1)?.value ?? null
/** The value `n` places from the end (`-3` = two bars before the last) — AO's saucer needs three. */
const at = (s: LineData[], n: number): number | null => s.at(n)?.value ?? null
const prev = (s: LineData[]): number | null => s.at(-2)?.value ?? null

/** Rising/falling by the last two prints; null when there aren't two. */
const rising = (s: LineData[]): boolean | null => {
  const a = prev(s)
  const b = last(s)
  return a === null || b === null ? null : b > a
}

const row = (name: string, value: number | null, action: RatingAction | null): RatingRow => ({
  name,
  value,
  action,
})

/** Simple mean of the last `period` closes — the plain SMA the MA table votes with. */
function smaLast(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null
  let sum = 0
  for (let i = candles.length - period; i < candles.length; i++) sum += candles[i]!.close
  return sum / period
}

function group(rows: RatingRow[]): RatingGroup {
  const buys = rows.filter((r) => r.action === 'buy').length
  const sells = rows.filter((r) => r.action === 'sell').length
  const neutrals = rows.filter((r) => r.action === 'neutral').length
  const voted = buys + sells + neutrals
  const score = voted > 0 ? (buys - sells) / voted : null
  return { rows, buys, sells, neutrals, score, verdict: verdictOf(score) }
}

export function computeTechnicalRatings(candles: Candle[]): TechnicalRatings | null {
  const price = candles.at(-1)?.close
  if (price === undefined || candles.length < 3) return null

  // ---- Oscillators ------------------------------------------------------------
  // Values come from the indicator math; the VOTES come from `ratingRules.ts`, where each rule
  // is a pure function pinned to the published methodology by its own test table.
  const rsi14 = rsi(candles, 14)
  const st = stoch(candles, 14, 3, 3)
  const stK = last(st.k)
  const stD = last(st.d)
  const cci20 = cci(candles, 20)
  const adx14 = adx(candles, 14)
  const adxVal = last(adx14.adx)
  // AO renders as a histogram; the vote only needs the value series (three bars of it — the
  // saucer rule reads the middle bar).
  const aoSeries: LineData[] = ao(candles).map((p) => ({ time: p.time, value: p.value }))
  const aoLast = last(aoSeries)
  const mom10 = momentum(candles, 10)
  const macdAll = macd(candles, 12, 26, 9)
  const macdVal = last(macdAll.macd)
  const srsi = stochRsi(candles, 14, 14, 3, 3)
  const srsiK = last(srsi.k)
  const wr14 = williamsR(candles, 14)
  // The table prints the COMBINED Elder-Ray figure (what a chart plots); the vote reads its two
  // halves against the trend EMA, which is Elder's own rule.
  const bbp13 = bullBearPower(candles, 13)
  const elder = elderRay(candles, 13)
  const uo = ultimateOscillator(candles, 7, 14, 28)
  const uoLast = last(uo)

  const oscillators = group([
    row('Relative Strength Index (14)', last(rsi14), rsiVote(last(rsi14), prev(rsi14))),
    row('Stochastic %K (14, 3, 3)', stK, stochVote(stK, stD)),
    row('Commodity Channel Index (20)', last(cci20), cciVote(last(cci20), prev(cci20))),
    row(
      'Average Directional Index (14)',
      adxVal,
      adxVote(
        adxVal,
        last(adx14.plusDi),
        last(adx14.minusDi),
        prev(adx14.plusDi),
        prev(adx14.minusDi),
      ),
    ),
    row('Awesome Oscillator', aoLast, aoVote(aoLast, prev(aoSeries), at(aoSeries, -3))),
    row('Momentum (10)', last(mom10), momentumVote(last(mom10), prev(mom10))),
    row('MACD Level (12, 26)', macdVal, macdVote(macdVal, last(macdAll.signal))),
    row('Stochastic RSI Fast (3, 3, 14, 14)', srsiK, stochRsiVote(srsiK, last(srsi.d))),
    row('Williams Percent Range (14)', last(wr14), williamsVote(last(wr14), prev(wr14))),
    row(
      'Bull Bear Power (13)',
      last(bbp13),
      bullBearVote(
        rising(elder.trend),
        last(elder.bull),
        prev(elder.bull),
        last(elder.bear),
        prev(elder.bear),
      ),
    ),
    row('Ultimate Oscillator (7, 14, 28)', uoLast, ultimateVote(uoLast)),
  ])

  // ---- Moving averages --------------------------------------------------------
  const maRows: RatingRow[] = []
  for (const period of [10, 20, 30, 50, 100, 200] as const) {
    const e = last(ema(candles, period))
    maRows.push(row(`Exponential Moving Average (${period})`, e, maVote(price, e)))
    const s = smaLast(candles, period)
    maRows.push(row(`Simple Moving Average (${period})`, s, maVote(price, s)))
  }
  // Ichimoku votes on the WHOLE system, not on price-vs-base-line. The published rule stacks
  // four conditions — cloud bullish (span A > span B), base line above the cloud's upper edge,
  // conversion above base, and price above conversion — and the mirror for a sell. Anything
  // else is Neutral, which is most of the time; that is the point of a gated system.
  //
  // The spans are read AT THE LAST CANDLE, not at the end of their series: `ichimoku()` projects
  // the cloud 26 bars into the future (that is what makes it leading), so `last(spanA)` is the
  // cloud over EMPTY space. Reading the projected tail would rate a market against a cloud that
  // has nothing to do with where price is now.
  const ich = ichimoku(candles, 9, 26, 52)
  const kijun = last(ich.kijun)
  const lastTime = candles.at(-1)!.time
  const cloudAt = (series: LineData[]): number | null => {
    for (let i = series.length - 1; i >= 0; i--) {
      const point = series[i]!
      if ((point.time as number) === lastTime) return point.value
      if ((point.time as number) < lastTime) return null
    }
    return null
  }
  maRows.push(
    row(
      'Ichimoku Base Line (9, 26, 52, 26)',
      kijun,
      ichimokuVote(price, last(ich.tenkan), kijun, cloudAt(ich.spanA), cloudAt(ich.spanB)),
    ),
  )
  const vwma20 = last(vwma(candles, 20))
  maRows.push(row('Volume Weighted Moving Average (20)', vwma20, maVote(price, vwma20)))
  const hma9 = last(hma(candles, 9))
  maRows.push(row('Hull Moving Average (9)', hma9, maVote(price, hma9)))

  const movingAverages = group(maRows)
  // The published Summary is the MEAN OF THE TWO GROUP SCORES, not a pool of all rows — pooling
  // would let the 15-row MA table outvote the 11 oscillators. Counts stay pooled (they are the
  // literal tallies); only the score/verdict follow the averaged methodology.
  const pooled = group([...oscillators.rows, ...movingAverages.rows])
  const summaryScore =
    oscillators.score !== null && movingAverages.score !== null
      ? (oscillators.score + movingAverages.score) / 2
      : (oscillators.score ?? movingAverages.score)
  const summary: RatingGroup = { ...pooled, score: summaryScore, verdict: verdictOf(summaryScore) }
  return { oscillators, movingAverages, summary }
}

export { renderTechnicalRatingsText } from './technicalRatingsText'
