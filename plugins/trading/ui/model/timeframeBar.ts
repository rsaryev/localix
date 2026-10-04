/**
 * Pure layout for the chart's timeframe toolbar (Hyperliquid-style: a quiet row of bare text
 * buttons above the canvas — `5m 1h D 1m ▾` — where the chevron opens the rest).
 *
 * The INLINE set is the preferred timeframes the venue ACTUALLY supports, in preferred order; every
 * other supported timeframe folds into the overflow dropdown. Nothing is invented: a venue that does
 * not list `1m` never grows a `1m` button, because the layout is derived from `describe.timeframes`.
 *
 * A label is cosmetic ONLY — {@link timeframeLabel} maps `1d → D`, but the VALUE stays the exact
 * ccxt key (`1d`) we send, so a `D` button always requests the timeframe the venue answers.
 *
 * The keys are CASE-SENSITIVE and two of them differ by nothing else: `1m` is one MINUTE and `1M` is
 * one MONTH. A trader reading a bare `1m` cannot tell which, and getting it wrong means reading a
 * month of price action as a minute of it. {@link timeframeTitle} spells the unit out, and every
 * surface that renders a timeframe attaches it.
 */

/** Cosmetic short labels for the long-period keys. Anything absent renders its key verbatim. */
const LABELS: Record<string, string> = {
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
}

/** The short label for a timeframe key — cosmetic; the key itself is what gets requested. */
export function timeframeLabel(tf: string): string {
  return LABELS[tf] ?? tf
}

/** Singular/plural unit names, keyed by the ccxt suffix. `m` is minute; `M` is month. */
const UNITS: Record<string, string> = { m: 'minute', h: 'hour', d: 'day', w: 'week', M: 'month' }

/**
 * The timeframe spelled out — `1m → "1 minute"`, `1M → "1 month"`, `15m → "15 minutes"`.
 *
 * This is the whole defence against the one ambiguity in the vocabulary: `m` and `M` are a minute
 * and a month, and a bar rendering `1m` beside `M` never says which is which. An unrecognised key is
 * returned verbatim rather than guessed at — we would rather show the raw token than name the wrong
 * unit.
 */
export function timeframeTitle(tf: string): string {
  const match = /^(\d+)([mhdwM])$/.exec(tf)
  if (!match) return tf
  const amount = Number(match[1])
  const unit = UNITS[match[2]!]!
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`
}

export interface TimeframeLayout {
  /** Preferred + supported timeframes, in preferred order — shown inline as bare buttons. */
  inline: string[]
  /** Every other supported timeframe (venue order) — behind the chevron dropdown. */
  overflow: string[]
}

/**
 * Split the venue's supported `timeframes` into an inline favourite set + an overflow list.
 * `preferred` is the common set to surface inline (e.g. `['1h','15m','1m','4h','1d']`); only those
 * the venue supports appear. Every supported timeframe lands in exactly one of the two lists.
 */
export function layoutTimeframes(
  timeframes: readonly string[],
  preferred: readonly string[],
): TimeframeLayout {
  const supported = new Set(timeframes)
  const inline = preferred.filter((t) => supported.has(t))
  const inlineSet = new Set(inline)
  const overflow = timeframes.filter((t) => !inlineSet.has(t))
  return { inline, overflow }
}
