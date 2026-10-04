/**
 * THE VOTING RULES of the technical rating, as pure functions over already-computed indicator
 * values — one function per rule, no candle arrays, no indicator math.
 *
 * Why they live apart from `technicalRatings.ts`: a rule is a CLAIM about what a number means
 * ("an oversold %K crossing an oversold %D is a buy"), and a claim should be readable and
 * testable without constructing a market that produces it. `ratingRules.test.ts` drives every
 * branch of every rule from literal numbers, so the published methodology is pinned directly
 * rather than inferred from whatever a synthetic candle tape happens to compute.
 *
 * SOURCES. The rules are the standard published technical-rating rules. [ELDER] is Alexander
 * Elder, Trading for a Living (1993), the originating text for Elder-Ray.
 *
 * Where conventions differ, the divergence is stated at the rule and the symmetric reading wins.
 * Every rule that cannot decide returns 'neutral'; a caller with a missing input passes `null`
 * and gets `null` back — an abstention, never a fabricated vote.
 */

export type RatingAction = 'buy' | 'sell' | 'neutral'

/** True when every argument is a real number — the guard every rule opens with. */
const known = (...values: (number | null)[]): boolean =>
  values.every((v) => v !== null && Number.isFinite(v))

/**
 * RSI (14) — `rsi < 30 && rsi > prev` buy, `rsi > 70 && rsi < prev` sell.
 * The direction term is what separates "oversold and turning" from "oversold and still falling".
 */
export function rsiVote(rsi: number | null, prev: number | null): RatingAction | null {
  if (!known(rsi, prev)) return null
  if (rsi! < 30 && rsi! > prev!) return 'buy'
  if (rsi! > 70 && rsi! < prev!) return 'sell'
  return 'neutral'
}

/**
 * Stochastic (14, 3, 3) — BOTH lines in the extreme and %K crossing %D.
 * `%K < 20 && %D < 20 && %K > %D` buy; `%K > 80 && %D > 80 && %K < %D` sell.
 *
 * The `%D` term matters: an oversold %K crossing a mid-range %D is the ordinary wiggle of a
 * downtrend, and rating it a buy is how a gauge turns into noise.
 */
export function stochVote(k: number | null, d: number | null): RatingAction | null {
  if (!known(k, d)) return null
  if (k! < 20 && d! < 20 && k! > d!) return 'buy'
  if (k! > 80 && d! > 80 && k! < d!) return 'sell'
  return 'neutral'
}

/** Stochastic RSI (3, 3, 14, 14) — same both-lines discipline as the plain Stochastic. */
export const stochRsiVote = stochVote

/** CCI (20) — `< −100 && rising` buy, `> 100 && falling` sell. */
export function cciVote(cci: number | null, prev: number | null): RatingAction | null {
  if (!known(cci, prev)) return null
  if (cci! < -100 && cci! > prev!) return 'buy'
  if (cci! > 100 && cci! < prev!) return 'sell'
  return 'neutral'
}

/**
 * ADX (14) — trend STRENGTH gates a DI CROSS: `ADX > 20 && prev(+DI) < prev(−DI) && +DI > −DI`
 * buy, mirrored for sell.
 *
 * A slope rule is also published — ADX rising for buy, ADX FALLING for sell — which is asymmetric
 * in a way that has a decaying downtrend voting sell hardest. The cross is the symmetric,
 * event-shaped reading and is what runs here.
 */
export function adxVote(
  adx: number | null,
  plusDi: number | null,
  minusDi: number | null,
  plusDiPrev: number | null,
  minusDiPrev: number | null,
): RatingAction | null {
  if (!known(adx, plusDi, minusDi, plusDiPrev, minusDiPrev)) return null
  if (adx! <= 20) return 'neutral'
  if (plusDiPrev! < minusDiPrev! && plusDi! > minusDi!) return 'buy'
  if (plusDiPrev! > minusDiPrev! && plusDi! < minusDi!) return 'sell'
  return 'neutral'
}

/**
 * Awesome Oscillator — two signals and only two:
 *   buy:  zero-line cross up, OR a SAUCER above zero (`ao2 > ao1 && ao1 < ao0`, all above zero)
 *   sell: the mirror below zero.
 *
 * The saucer's middle-bar dip is the whole signal. Dropping it (voting any up-tick above zero)
 * makes AO vote buy through most of an uptrend, which is not what a saucer means.
 */
export function aoVote(
  ao: number | null,
  ao1: number | null,
  ao2: number | null,
): RatingAction | null {
  if (!known(ao)) return null
  if (known(ao1)) {
    if (ao1! < 0 && ao! > 0) return 'buy'
    if (ao1! > 0 && ao! < 0) return 'sell'
  }
  if (known(ao1, ao2)) {
    if (ao! > 0 && ao1! > 0 && ao! > ao1! && ao2! > ao1!) return 'buy'
    if (ao! < 0 && ao1! < 0 && ao! < ao1! && ao2! < ao1!) return 'sell'
  }
  return 'neutral'
}

/** Momentum (10) — pure slope; an UNCHANGED value is Neutral, not a sell. */
export function momentumVote(mom: number | null, prev: number | null): RatingAction | null {
  if (!known(mom, prev)) return null
  if (mom! > prev!) return 'buy'
  if (mom! < prev!) return 'sell'
  return 'neutral'
}

/** MACD (12, 26, 9) — line against signal; equality is Neutral. */
export function macdVote(macd: number | null, signal: number | null): RatingAction | null {
  if (!known(macd, signal)) return null
  if (macd! > signal!) return 'buy'
  if (macd! < signal!) return 'sell'
  return 'neutral'
}

/** Williams %R (14) — `< −80 && rising` buy, `> −20 && falling` sell. */
export function williamsVote(wr: number | null, prev: number | null): RatingAction | null {
  if (!known(wr, prev)) return null
  if (wr! < -80 && wr! > prev!) return 'buy'
  if (wr! > -20 && wr! < prev!) return 'sell'
  return 'neutral'
}

/**
 * Bull Bear Power (13) — [ELDER]: the two HALVES read against the trend.
 *   buy:  13-EMA rising, BEAR power < 0 and recovering  (bears losing a pullback in an uptrend)
 *   sell: 13-EMA falling, BULL power > 0 and fading     (bulls losing a bounce in a downtrend)
 *
 * Not the combined figure's sign and slope: that fires on any strong bar in any regime, which
 * is a different claim entirely. The table still PRINTS the combined value — that is the series
 * a chart plots — but the vote is Elder's.
 */
export function bullBearVote(
  trendRising: boolean | null,
  bull: number | null,
  bullPrev: number | null,
  bear: number | null,
  bearPrev: number | null,
): RatingAction | null {
  if (trendRising === null || !known(bull, bullPrev, bear, bearPrev)) return null
  if (trendRising && bear! < 0 && bear! > bearPrev!) return 'buy'
  if (!trendRising && bull! > 0 && bull! < bullPrev!) return 'sell'
  return 'neutral'
}

/**
 * Ultimate Oscillator (7, 14, 28) — rated as MOMENTUM: `> 70` buy, `< 30` sell.
 *
 * This reads backwards next to RSI/CCI/W%R, whose extremes are mean-reverting, and it was once
 * implemented the other way here for exactly that reason. It is nonetheless what the published
 * methodology states, and a composite gauge is only comparable when every constituent follows
 * the same book. The house's own mean-reversion reads are separate, labelled, and beside the
 * tables — never a silent edit to a standard vote.
 */
export function ultimateVote(uo: number | null): RatingAction | null {
  if (!known(uo)) return null
  if (uo! > 70) return 'buy'
  if (uo! < 30) return 'sell'
  return 'neutral'
}

/**
 * Ichimoku (9, 26, 52, 26) — the WHOLE system, four stacked conditions.
 *   buy:  spanA > spanB, base > spanA, conversion > base, price > conversion
 *   sell: the mirror.
 *
 * Anything else is Neutral, which is most of the time — that is what a gated system is for.
 * `spanA`/`spanB` must be the cloud AT THE PRICE BAR, not the projected tail 26 bars ahead.
 */
export function ichimokuVote(
  price: number | null,
  conversion: number | null,
  base: number | null,
  spanA: number | null,
  spanB: number | null,
): RatingAction | null {
  if (!known(price, conversion, base, spanA, spanB)) return null
  if (spanA! > spanB! && base! > spanA! && conversion! > base! && price! > conversion!) return 'buy'
  if (spanA! < spanB! && base! < spanA! && conversion! < base! && price! < conversion!)
    return 'sell'
  return 'neutral'
}

/** Moving averages (all types) — `MA < price` buy, `MA > price` sell, equal Neutral. */
export function maVote(price: number, value: number | null): RatingAction | null {
  if (!known(value)) return null
  if (price > value!) return 'buy'
  if (price < value!) return 'sell'
  return 'neutral'
}
