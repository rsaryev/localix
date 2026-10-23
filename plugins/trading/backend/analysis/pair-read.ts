/**
 * PAIR read — mined from the Vibe-Trading pair-trading / correlation skills: how two markets
 * move TOGETHER, and how stretched their relationship is right now.
 *
 * - CORRELATION of log returns over the window — is the pair even a pair;
 * - BETA of A on B (OLS on log returns) — how many units of B-move a unit of A-move carries;
 * - RATIO Z-SCORE: `z = (ratio − rollingMean) / rollingStd` of `closeA / closeB` over
 *   `lookback` bars — the mined signal: |z| ≥ 2 is the classic entry stretch (short the rich
 *   leg / long the cheap one, EXPECTING mean reversion), |z| < 0.5 is "reverted".
 *
 * Bars are aligned by TIMESTAMP INTERSECTION — two venues (or a listing gap) must never pair
 * bar i of A with a different wall-clock bar of B. Below `lookback` aligned bars the read
 * abstains. Pure — injected candles, no I/O.
 */
import type { Candle } from '../contracts'

export interface PairRead {
  /** Pearson correlation of aligned log returns, −1..1. */
  correlation: number
  /** OLS beta of A's log returns on B's. */
  beta: number
  /** Current ratio z-score vs its rolling window. */
  zScore: number
  state: 'stretched_rich' | 'stretched_cheap' | 'near_mean' | 'drifting'
  /** Aligned bars the figures rest on. */
  bars: number
}

/** The mined defaults: 60-bar lookback, entry at |z|≥2, exit under 0.5. */
const LOOKBACK = 60
const ENTRY_Z = 2
const EXIT_Z = 0.5

/** Timestamp-intersection close alignment + log-return correlation and beta of A on B.
 *  Null below `minBars` aligned closes or on a zero-variance leg. */
export function alignedReturnStats(
  a: readonly Candle[],
  b: readonly Candle[],
  minBars: number,
): { correlation: number; beta: number; closesA: number[]; closesB: number[] } | null {
  const byTime = new Map(b.map((c) => [c.time, c.close]))
  const closesA: number[] = []
  const closesB: number[] = []
  for (const c of a) {
    const other = byTime.get(c.time)
    if (other !== undefined && c.close > 0 && other > 0) {
      closesA.push(c.close)
      closesB.push(other)
    }
  }
  const n = closesA.length
  if (n < minBars) return null
  const rA: number[] = []
  const rB: number[] = []
  for (let i = 1; i < n; i++) {
    rA.push(Math.log(closesA[i]! / closesA[i - 1]!))
    rB.push(Math.log(closesB[i]! / closesB[i - 1]!))
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const mA = mean(rA)
  const mB = mean(rB)
  let cov = 0
  let vA = 0
  let vB = 0
  for (let i = 0; i < rA.length; i++) {
    cov += (rA[i]! - mA) * (rB[i]! - mB)
    vA += (rA[i]! - mA) ** 2
    vB += (rB[i]! - mB) ** 2
  }
  if (vA === 0 || vB === 0) return null
  return { correlation: cov / Math.sqrt(vA * vB), beta: cov / vB, closesA, closesB }
}

export function pairRead(a: readonly Candle[], b: readonly Candle[]): PairRead | null {
  const stats = alignedReturnStats(a, b, LOOKBACK + 1)
  if (!stats) return null
  const { correlation, beta, closesA, closesB } = stats

  // Ratio z-score over the LAST `lookback` ratios.
  const ratios = closesA.map((c, i) => c / closesB[i]!)
  const window = ratios.slice(-LOOKBACK)
  const wMean = window.reduce((s, r) => s + r, 0) / window.length
  const wVar = window.reduce((s, r) => s + (r - wMean) ** 2, 0) / (window.length - 1)
  const wStd = Math.sqrt(wVar)
  if (!(wStd > 0)) return null
  const zScore = (ratios[ratios.length - 1]! - wMean) / wStd

  const state: PairRead['state'] =
    zScore >= ENTRY_Z
      ? 'stretched_rich'
      : zScore <= -ENTRY_Z
        ? 'stretched_cheap'
        : Math.abs(zScore) < EXIT_Z
          ? 'near_mean'
          : 'drifting'
  return { correlation, beta, zScore, state, bars: closesA.length }
}

const num = (v: number) => Number(v.toPrecision(3)).toString()

/** The read as report lines. The honesty note matters: a stretch is only tradable when the
 *  correlation genuinely holds — a broken pair "reverts" by never coming back. */
export function renderPairRead(symbolA: string, symbolB: string, p: PairRead): string[] {
  const stateNote =
    p.state === 'stretched_rich'
      ? `${symbolA} RICH vs the pair (z ${num(p.zScore)} ≥ 2) — the mined mean-reversion entry: short the rich leg / long the cheap one`
      : p.state === 'stretched_cheap'
        ? `${symbolA} CHEAP vs the pair (z ${num(p.zScore)} ≤ −2) — the mined mean-reversion entry: long the cheap leg / short the rich one`
        : p.state === 'near_mean'
          ? `near the mean (|z| ${num(Math.abs(p.zScore))} < 0.5) — no stretch to trade`
          : `drifting (z ${num(p.zScore)}) — neither stretched nor reverted`
  return [
    `- pair vs ${symbolB}: correlation ${num(p.correlation)}, beta ${num(p.beta)} over ${p.bars} aligned bars; ` +
      `ratio ${stateNote}. ` +
      (Math.abs(p.correlation) < 0.6
        ? 'CAUTION: correlation under 0.6 — this is barely a pair; a stretch in a broken pair reverts by never coming back.'
        : 'Mean reversion is the bet, not a promise — size as a spread, both legs.'),
  ]
}
