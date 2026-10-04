/**
 * PORTFOLIO concentration via pairwise correlation — the portfolio-level face of the pair
 * read. Two positions whose returns move together are, for risk purposes, ONE position at
 * their combined size: a long BTC + long ETH book at correlation 0.85 draws down as a single
 * ~2× bet, and diversification the holder believes in does not exist. The classic reference is
 * Markowitz portfolio theory's covariance term — correlation is what decides whether sizes add
 * or offset.
 *
 * Warns on: same-direction legs with correlation ≥ +0.7 (sizes ADD — hidden concentration) and
 * opposite-direction legs with correlation ≥ +0.7 (a hedge that actually works but caps both
 * legs' upside — stated so it is a choice, not an accident). Anti-correlated same-direction
 * legs are genuine diversification and stay silent. Pure — injected candles, no I/O.
 */
import type { Candle } from '../contracts'
import { alignedReturnStats } from './pair-read'

export interface ExposedLeg {
  symbol: string
  side: 'long' | 'short'
  /** Absolute quote value of the leg. */
  notional: number
}

export interface ConcentrationWarning {
  a: string
  b: string
  correlation: number
  kind: 'adds_up' | 'offsetting_hedge'
  /** Combined absolute notional of the two legs — meaningful ONLY when they share a quote
   *  currency (`sameQuote`); a raw sum across USDC and USDT legs would be nonsense. */
  combinedNotional: number
  /** The shared quote currency when both legs settle in it, else undefined. */
  quote?: string
  aNotional: number
  bNotional: number
}

/** The currency a unified symbol settles in (`BTC/USDC:USDC` → `USDC`). */
function quoteOf(symbol: string): string | undefined {
  return symbol.split('/')[1]?.split(':')[0]
}

/** Correlation at/above this, the pair behaves as one book for risk purposes. */
const CONCENTRATION_CORR = 0.7
/** Aligned bars required before a correlation claim is made (same floor as the pair read). */
const MIN_BARS = 61
export function concentrationWarnings(
  legs: readonly ExposedLeg[],
  candlesBySymbol: ReadonlyMap<string, readonly Candle[]>,
): ConcentrationWarning[] {
  const out: ConcentrationWarning[] = []
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i]!
      const b = legs[j]!
      // Two legs on the SAME instrument (an isolated + a cross entry, a net-flat book) are one
      // instrument correlated with itself, not a diversification/hedge story — skip them.
      if (a.symbol === b.symbol) continue
      const ca = candlesBySymbol.get(a.symbol)
      const cb = candlesBySymbol.get(b.symbol)
      if (!ca || !cb) continue
      const stats = alignedReturnStats(ca, cb, MIN_BARS)
      if (!stats || stats.correlation < CONCENTRATION_CORR) continue
      const qa = quoteOf(a.symbol)
      const qb = quoteOf(b.symbol)
      const sameQuote = qa !== undefined && qa === qb
      out.push({
        a: a.symbol,
        b: b.symbol,
        correlation: stats.correlation,
        kind: a.side === b.side ? 'adds_up' : 'offsetting_hedge',
        combinedNotional: a.notional + b.notional,
        aNotional: a.notional,
        bNotional: b.notional,
        ...(sameQuote ? { quote: qa } : {}),
      })
    }
  }
  // Worst concentration first. When quotes differ the combined sum is not comparable, so rank
  // those by the LARGER leg — a safe proxy that never lets a cross-quote pair outrank a real
  // same-quote combined book it does not actually exceed.
  const rank = (w: ConcentrationWarning) =>
    w.quote !== undefined ? w.combinedNotional : Math.max(w.aNotional, w.bNotional)
  return out.sort((x, y) => rank(y) - rank(x))
}

const num = (v: number) => Number(v.toPrecision(3)).toString()

/** The warnings as report lines — empty when the book is genuinely diversified. */
export function renderConcentration(warnings: readonly ConcentrationWarning[]): string[] {
  if (warnings.length === 0) return []
  return [
    '- correlation concentration (positions whose returns move together are ONE position for risk):',
    ...warnings.map((w) => {
      // The combined size is quotable only when both legs share a quote currency.
      const size = w.quote
        ? `~${num(w.combinedNotional)} ${w.quote}`
        : `${num(w.aNotional)} + ${num(w.bNotional)} in different quote currencies (sum them yourself)`
      return w.kind === 'adds_up'
        ? `    · ${w.a} + ${w.b}: correlation ${num(w.correlation)}, same direction — effectively ONE ` +
            `${size} position; a drawdown hits both legs at once`
        : `    · ${w.a} vs ${w.b}: correlation ${num(w.correlation)}, opposite directions — a working ` +
            `hedge that also caps both legs' upside; keep it only if the hedge is intentional`
    }),
  ]
}
