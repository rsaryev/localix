/**
 * LIQUIDITY POOLS — the last Smart-Money-Concepts / ICT piece (mined from the Vibe-Trading SMC
 * skill): clusters of near-EQUAL swing highs (or lows). Retail stops rest just beyond obvious
 * equal extremes, so the market is repeatedly drawn to SWEEP them — wick through, collect the
 * stops, and often reverse (the "liquidity grab"). Buy-side liquidity sits above equal highs,
 * sell-side below equal lows.
 *
 * Reads the SAME `pivots()` swings the level clustering and structure detection use — one swing
 * vocabulary across the whole analysis layer. A pool needs ≥2 swings within a tight tolerance;
 * an unswept pool is a magnet reference, and a JUST-SWEPT pool (a recent bar wicked through but
 * closed back inside) is flagged — that is the classic reversal tell. Pure — no I/O.
 */
import type { Candle } from '../contracts'
import { pivots, type Pivot } from './pattern-detect'
import { toolNumber } from '../tool-number'

export interface LiquidityPool {
  /** buy-side = stops above equal HIGHS; sell-side = stops below equal LOWS. */
  side: 'buy-side' | 'sell-side'
  /** The pool's level — the extreme of the clustered swings (where the stops actually rest). */
  price: number
  /** How many swings form the cluster (2 = a double, 3+ = heavily watched). */
  touches: number
  /** Signed percent distance from the reference price (positive = the pool sits above). */
  distancePct: number
  /** A recent bar traded THROUGH the level but closed back inside — the sweep just happened. */
  swept: boolean
}

/** Swings within this fraction of price of each other read as "equal" extremes. */
const EQUAL_TOLERANCE = 0.0015
/** How many trailing bars count as "recent" for the sweep flag. */
const SWEEP_RECENCY_BARS = 5

/** Cluster same-side pivots into equal-extreme pools (≥2 members within tolerance). */
function pools(points: Pivot[], side: LiquidityPool['side'], price: number): LiquidityPool[] {
  const sorted = [...points].sort((a, b) => a.price - b.price)
  const out: LiquidityPool[] = []
  let group: Pivot[] = []
  const flush = () => {
    if (group.length >= 2) {
      // Stops rest beyond the EXTREME of the cluster, not its mean.
      const level =
        side === 'buy-side'
          ? Math.max(...group.map((p) => p.price))
          : Math.min(...group.map((p) => p.price))
      out.push({
        side,
        price: level,
        touches: group.length,
        distancePct: ((level - price) / price) * 100,
        swept: false,
      })
    }
    group = []
  }
  for (const p of sorted) {
    if (group.length === 0 || p.price - group[group.length - 1]!.price <= price * EQUAL_TOLERANCE) {
      group.push(p)
    } else {
      flush()
      group = [p]
    }
  }
  flush()
  return out
}

/**
 * Liquidity pools near `price`, nearest first, capped per side. A pool a recent bar wicked
 * THROUGH but closed back inside is flagged `swept` (the grab just happened); a pool a recent
 * bar closed BEYOND is no longer liquidity (the stops are gone, the level broke) and is dropped.
 */
export function detectLiquidityPools(candles: Candle[], span = 3, maxPerSide = 2): LiquidityPool[] {
  const price = candles.at(-1)?.close
  if (price === undefined || !(price > 0) || candles.length < span * 2 + 3) return []
  const { highs, lows } = pivots(candles, span)
  const all = [...pools(highs, 'buy-side', price), ...pools(lows, 'sell-side', price)]
  const recent = candles.slice(-SWEEP_RECENCY_BARS)

  const alive = all.filter((pool) => {
    // Broken (a recent close beyond the level) ⇒ not a pool any more.
    const closedBeyond = recent.some((c) =>
      pool.side === 'buy-side' ? c.close > pool.price : c.close < pool.price,
    )
    if (closedBeyond) return false
    pool.swept = recent.some((c) =>
      pool.side === 'buy-side'
        ? c.high > pool.price && c.close <= pool.price
        : c.low < pool.price && c.close >= pool.price,
    )
    return true
  })

  const bySide = (side: LiquidityPool['side']) =>
    alive
      .filter((p) => p.side === side)
      .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
      .slice(0, maxPerSide)
  return [...bySide('buy-side'), ...bySide('sell-side')].sort(
    (a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct),
  )
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The pools as report lines — a fresh sweep is the headline (the classic reversal tell). */
export function renderLiquidityPools(poolsFound: LiquidityPool[]): string[] {
  if (poolsFound.length === 0) return []
  const lines: string[] = []
  const sweep = poolsFound.find((p) => p.swept)
  if (sweep) {
    lines.push(
      `- LIQUIDITY SWEEP just printed: ${sweep.side} pool at ${toolNumber(sweep.price)} was wicked through and price closed back — the classic stop-grab; watch for the reversal.`,
    )
  }
  lines.push(
    '- liquidity pools (equal-extreme stop clusters the market is drawn to sweep — SMC/ICT; nearest first):',
  )
  for (const p of poolsFound) {
    lines.push(
      `    · ${p.side} ${toolNumber(p.price)} (${p.touches} equal ${p.side === 'buy-side' ? 'highs' : 'lows'}, ` +
        `${p.distancePct >= 0 ? '+' : ''}${toolNumber(p.distancePct)}%${p.swept ? ', JUST SWEPT' : ''})`,
    )
  }
  return lines
}
