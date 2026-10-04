import type { Candle } from '../../backend/contracts'
import { compositeSignal, type CompositeSignal } from '../../backend/analysis/composite-signal'
import { classifyRegime, trendFit, type MarketRegime } from '../../backend/analysis/pattern-detect'
import { confluenceFromCandles, type ConfluenceZone } from '../../backend/analysis/confluence'
import { detectRsiDivergence, type Divergence } from '../../backend/analysis/divergence'
import { volatilityReadout, type VolatilityReadout } from '../../backend/analysis/volatility'
import { hvPercentile, type HvReadout } from '../../backend/analysis/hv-percentile'
import { detectStructureBreak, type StructureBreak } from '../../backend/analysis/structure-breaks'
import { volumeProfile, valueAreaPosition } from '../../backend/analysis/volume-profile'
import { sessionVwap, type SessionVwap } from '../../backend/analysis/vwap-analysis'
import { detectFairValueGaps, type FairValueGap } from '../../backend/analysis/fair-value-gaps'
import { detectOrderBlocks, type OrderBlock } from '../../backend/analysis/order-blocks'
import { detectLiquidityPools, type LiquidityPool } from '../../backend/analysis/liquidity-pools'
import { ichimokuSignal, type IchimokuSignal } from '../../backend/analysis/ichimoku-signal'
import {
  detectHarmonicPattern,
  type HarmonicPattern,
} from '../../backend/analysis/harmonic-patterns'

/**
 * The chart's "current read" — the same market regime + composite Trend/Momentum/Volume signal the
 * agent's `detect` tool reports, computed CLIENT-SIDE from the loaded candles so the user can see it
 * on the chart without a round-trip. Pure and cheap-enough to run on demand; the Analyze popover
 * computes it only while open (not on every streaming tick).
 *
 * One math, three surfaces: the regime/signal here are the exact functions the backend detect uses
 * (`backend/analysis/*`), which in turn use the chart's own indicator math — so what the popover
 * shows, what the agent reasons from, and what the legend draws can never disagree.
 */
export interface ChartRead {
  regime: MarketRegime | null
  signal: CompositeSignal | null
  /** Nearest level zones where several methods agree — the strongest references. */
  confluence: ConfluenceZone[]
  /** Regular (reversal) / hidden (continuation) RSI divergence on the recent swings. */
  divergence: Divergence[]
  /** ATR volatility — the sizing/stop context (how wide, expanding or contracting). */
  volatility: VolatilityReadout | null
  /** HV percentile — where current realized vol ranks in the window (squeeze / stretch). */
  hv: HvReadout | null
  /** Most recent BOS/ChoCH — whether the structure just continued or just cracked. */
  structureBreak: StructureBreak | null
  /** Where the last close sits vs the volume value area: 'premium' (above VAH — richly priced),
   *  'discount' (below VAL — cheap) or 'fair' (inside), with the POC. Null when no profile. */
  valueArea: { position: 'premium' | 'fair' | 'discount'; poc: number } | null
  /** Session VWAP (current UTC day) — the intraday benchmark and where price sits vs it. */
  vwap: SessionVwap | null
  /** Nearest unfilled fair value gap (SMC imbalance zone), or null. */
  fvg: FairValueGap | null
  /** Nearest unmitigated order block (SMC retest zone), or null. */
  orderBlock: OrderBlock | null
  /** Equal-extreme stop clusters, nearest first — a `swept` one is the stop-grab tell. */
  liquidity: LiquidityPool[]
  /** A recent Ichimoku TK cross with the school's cloud gating, or null. */
  ichimoku: IchimokuSignal | null
  /** A freshly-completed harmonic XABCD (its D is the Potential Reversal Zone), or null. */
  harmonic: HarmonicPattern | null
}

export function computeChartRead(candles: Candle[], timeframe?: string): ChartRead {
  const price = candles.at(-1)?.close
  const vp = volumeProfile(candles)
  return {
    regime: classifyRegime(candles, trendFit(candles)),
    signal: compositeSignal(candles),
    confluence: confluenceFromCandles(candles),
    divergence: detectRsiDivergence(candles),
    volatility: volatilityReadout(candles),
    // The rank works without a timeframe; the token only enables the annualized garnish.
    hv: hvPercentile(candles, timeframe ?? ''),
    structureBreak: detectStructureBreak(candles),
    valueArea:
      vp && price !== undefined ? { position: valueAreaPosition(vp, price), poc: vp.poc } : null,
    vwap: sessionVwap(candles),
    fvg: detectFairValueGaps(candles)[0] ?? null,
    orderBlock: detectOrderBlocks(candles)[0] ?? null,
    liquidity: detectLiquidityPools(candles),
    ichimoku: ichimokuSignal(candles),
    harmonic: detectHarmonicPattern(candles),
  }
}
