/**
 * Pure timeframe arithmetic, shared by the ccxt driver (deriving a default `since` for a venue
 * whose `fetchOHLCV` REQUIRES one) and the UI's backfill cursor maths.
 *
 * `m` is a MINUTE and `M` is a MONTH — the one pair of ccxt timeframe tokens that differs by case
 * alone, and the reason nothing here lower-cases a timeframe. A month is approximated at 30 days:
 * this figure only positions a `since` cursor, and the venue answers with the bars it actually has.
 */
/** The timeframe every read and chart opens on when nothing else is asked for. */
export const DEFAULT_TIMEFRAME = '1h'

/** The Technicals page's timeframe strip — the same rungs for the human page and the agent line. */
export const TECHNICALS_TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 2_592_000_000,
}

/** A timeframe's length in milliseconds, or `null` when it is not a shape we understand. */
export function timeframeMs(timeframe: string): number | null {
  const match = /^(\d+)([mhdwM])$/.exec(timeframe)
  if (!match) return null
  const amount = Number(match[1])
  const unit = UNIT_MS[match[2]!]
  return amount > 0 && unit ? amount * unit : null
}

/**
 * The `since` (ms) that asks for the LAST `limit` bars ending now — for a venue whose
 * `fetchOHLCV` refuses to run without one (ccxt throws `ArgumentsRequired` locally; Coinbase
 * International, e.g.).
 *
 * The window is `(limit − 1)` bars wide, not `limit`: a venue answers ASCENDING from `since` and
 * caps at `limit`, so a full-width window holding `limit` closed bars plus the in-progress one
 * would cut the LIVE bar off the end — a chart missing its leading candle. One fewer historical
 * bar is the cheaper loss (the backfill fetches older pages anyway).
 *
 * `null` when the timeframe is not a shape we understand — the caller then sends no `since`, which
 * is the pre-existing behaviour (and its error, on a venue that requires one).
 */
export function defaultOhlcvSince(timeframe: string, limit: number, now: number): number | null {
  const step = timeframeMs(timeframe)
  if (step === null || !Number.isFinite(limit) || limit < 1) return null
  return now - (Math.floor(limit) - 1) * step
}
