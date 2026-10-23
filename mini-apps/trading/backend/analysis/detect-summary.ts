/**
 * The one-line LEAD for a detect scan — the gestalt a reader (agent or human) needs before the
 * detail blocks: regime + primary trend, the composite bias with conviction, and the higher-
 * timeframe alignment. Purely a synthesis of pieces the scan ALREADY computed; it prescribes
 * nothing (no "buy"/"sell"), it only states the headline reads so the details below have an anchor.
 */
import type { CompositeSignal } from './composite-signal'
import type { MarketRegime, TrendFit } from './pattern-detect'
import type { TimeframeContext } from './timeframe-context'
import type { StructureBreak } from './structure-breaks'

export interface DetectSummaryParts {
  regime: MarketRegime | null
  trend: TrendFit | null
  signal: CompositeSignal | null
  htf: TimeframeContext | null
  /** The most recent BOS/ChoCH — the headline "what just happened", named up front. */
  structureBreak?: StructureBreak | null
  /** Price is sitting ON a confluence zone — the headline "where we are now" (a decision point). */
  atConfluence?: boolean
  /** Premium/discount vs the volume value area — the headline "rich or cheap" read. 'fair' and null
   *  are omitted (only the actionable extremes earn a place in the lead). */
  valueArea?: 'premium' | 'fair' | 'discount' | null
}

/** The summary line, or null when there is nothing decisive enough to summarise. */
export function renderDetectSummary(parts: DetectSummaryParts): string | null {
  const segments: string[] = []

  if (parts.regime) {
    const dir = parts.trend && parts.trend.direction !== 'flat' ? ` ${parts.trend.direction}` : ''
    segments.push(`${parts.regime.kind}${dir}`)
  }

  if (parts.structureBreak) {
    const b = parts.structureBreak
    segments.push(`${b.type} ${b.direction === 'bullish' ? '↑' : '↓'}`)
  }

  if (parts.signal) {
    segments.push(`composite ${parts.signal.bias} ${Math.round(parts.signal.conviction * 100)}%`)
  }

  if (parts.htf?.trend) {
    // Alignment vs the primary trend when both are directional; otherwise just the HTF trend.
    const primary = parts.trend?.direction
    const aligned =
      primary && primary !== 'flat' && parts.htf.trend !== 'flat'
        ? parts.htf.trend === primary
          ? ' aligned'
          : ' against'
        : ''
    segments.push(`${parts.htf.timeframe} ${parts.htf.trend}${aligned}`)
  }

  // Volume-based location — rich or cheap vs fair value (the neutral 'fair' is not worth a segment).
  if (parts.valueArea === 'premium' || parts.valueArea === 'discount')
    segments.push(parts.valueArea)

  // The decision-point flag last — it is the "act now" state the rest of the line contextualises.
  if (parts.atConfluence) segments.push('AT confluence')

  if (segments.length === 0) return null
  return `Summary: ${segments.join(' · ')}`
}
