/**
 * HARMONIC XABCD PATTERNS — the last mined Vibe-Trading school: Fibonacci-geometry structures
 * (Gartley / Bat / Butterfly / Crab) whose completion point D marks a Potential Reversal Zone
 * (PRZ). The classification is pure ratio arithmetic over the SAME `pivots()` swings the rest of
 * the analysis layer reads:
 *
 *   pattern    | B retracement of XA | D retracement of XA
 *   gartley    | ≈ 0.618             | ≈ 0.786
 *   bat        | 0.382 – 0.5         | ≈ 0.886
 *   butterfly  | ≈ 0.786             | ≈ 1.27  (D beyond X)
 *   crab       | 0.382 – 0.618       | ≈ 1.618 (deep extension)
 *
 * A bullish pattern completes with D at a LOW (buy zone), bearish at a HIGH. Honesty rules from
 * the source kept: ratios must match within a tolerance, the C leg must be a real retracement of
 * AB, and D must be RECENT — a stale completion is history, not a live PRZ. Report-only; wave
 * theory's subjectivity is exactly why this sticks to the one checkable geometry.
 */
import type { Candle } from '../contracts'
import { pivots, type Pivot } from './pattern-detect'
import { toolNumber } from '../tool-number'

export interface HarmonicPattern {
  pattern: 'gartley' | 'bat' | 'butterfly' | 'crab'
  direction: 'bullish' | 'bearish'
  /** The five swing points, oldest first. */
  x: number
  a: number
  b: number
  c: number
  d: number
  /** Measured retracements of XA (the classification inputs, citable). */
  bRatio: number
  dRatio: number
  /** Signed percent distance from the reference price to D (the PRZ). */
  distancePct: number
}

/** Absolute tolerance around a point ratio (the source's fib_tolerance, tightened a little). */
const TOL = 0.08
/** The C leg must be a genuine retracement of AB (0.382–0.886, padded by the tolerance). */
const C_MIN = 0.382 - TOL
const C_MAX = 0.886 + TOL
/** D older than this many bars is a completed history, not a live reversal zone. */
const RECENCY_BARS = 10

interface Swing extends Pivot {
  kind: 'high' | 'low'
}

/** Merge the pivot highs/lows into ONE time-ordered, strictly-alternating swing chain (of two
 *  same-kind neighbours the more extreme survives — the standard zigzag reduction). */
export function alternatingSwings(candles: Candle[], span = 3): Swing[] {
  const { highs, lows } = pivots(candles, span)
  const merged: Swing[] = [
    ...highs.map((p) => ({ ...p, kind: 'high' as const })),
    ...lows.map((p) => ({ ...p, kind: 'low' as const })),
  ].sort((a, b) => a.time - b.time)
  const out: Swing[] = []
  for (const s of merged) {
    const last = out.at(-1)
    if (!last || last.kind !== s.kind) {
      out.push(s)
    } else if (s.kind === 'high' ? s.price > last.price : s.price < last.price) {
      out[out.length - 1] = s
    }
  }
  return out
}

const near = (value: number, target: number): boolean => Math.abs(value - target) <= TOL
const within = (value: number, lo: number, hi: number): boolean =>
  value >= lo - TOL && value <= hi + TOL

/** Classify one XABCD candidate against the ratio table, or null. */
function classify(
  x: number,
  a: number,
  b: number,
  c: number,
  d: number,
): HarmonicPattern['pattern'] | null {
  const xa = Math.abs(a - x)
  const ab = Math.abs(b - a)
  if (xa === 0 || ab === 0) return null
  const bRatio = Math.abs(a - b) / xa
  const cRatio = Math.abs(c - b) / ab
  const dRatio = Math.abs(a - d) / xa
  if (!within(cRatio, C_MIN + TOL, C_MAX - TOL)) return null
  if (near(bRatio, 0.618) && near(dRatio, 0.786)) return 'gartley'
  if (within(bRatio, 0.382, 0.5) && near(dRatio, 0.886)) return 'bat'
  if (near(bRatio, 0.786) && near(dRatio, 1.27)) return 'butterfly'
  if (within(bRatio, 0.382, 0.618) && near(dRatio, 1.618)) return 'crab'
  return null
}

/** The completed harmonic pattern whose D is recent, or null. */
export function detectHarmonicPattern(candles: Candle[], span = 3): HarmonicPattern | null {
  const price = candles.at(-1)?.close
  if (price === undefined || !(price > 0)) return null
  const swings = alternatingSwings(candles, span)
  if (swings.length < 5) return null
  const [x, a, b, c, d] = swings.slice(-5) as [Swing, Swing, Swing, Swing, Swing]

  // D must be the pattern's completion: alternation guarantees X and D share a kind; a bullish
  // pattern completes at a LOW. And it must be RECENT — else the PRZ already played out.
  const cutoffIndex = Math.max(0, candles.length - 1 - RECENCY_BARS)
  if (d.time < candles[cutoffIndex]!.time) return null
  const direction: HarmonicPattern['direction'] = d.kind === 'low' ? 'bullish' : 'bearish'
  // Geometry sanity: a bullish XABCD is low-high-low-high-low (bearish mirrored).
  const expected: Swing['kind'][] =
    direction === 'bullish'
      ? ['low', 'high', 'low', 'high', 'low']
      : ['high', 'low', 'high', 'low', 'high']
  if ([x, a, b, c, d].some((s, i) => s.kind !== expected[i])) return null

  const pattern = classify(x.price, a.price, b.price, c.price, d.price)
  if (!pattern) return null
  const xa = Math.abs(a.price - x.price)
  return {
    pattern,
    direction,
    x: x.price,
    a: a.price,
    b: b.price,
    c: c.price,
    d: d.price,
    bRatio: Math.abs(a.price - b.price) / xa,
    dRatio: Math.abs(a.price - d.price) / xa,
    distancePct: ((d.price - price) / price) * 100,
  }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The pattern as a report line — name, direction, the PRZ and the measured ratios. */
export function renderHarmonicPattern(h: HarmonicPattern): string[] {
  return [
    `- harmonic: ${h.direction} ${h.pattern.toUpperCase()} completed at D ${toolNumber(h.d)} ` +
      `(${h.distancePct >= 0 ? '+' : ''}${toolNumber(h.distancePct)}% from price) — a Potential Reversal Zone; ` +
      `B retraced ${toolNumber(h.bRatio)} of XA, D ${toolNumber(h.dRatio)} ` +
      `(X ${toolNumber(h.x)} / A ${toolNumber(h.a)} / B ${toolNumber(h.b)} / C ${toolNumber(h.c)}). ` +
      'Geometry, not a guarantee — demand a reaction at the zone before acting.',
  ]
}
