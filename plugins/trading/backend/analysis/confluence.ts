/**
 * CONFLUENCE — where independent level methods AGREE. A price that is at once a pivot, a Fibonacci
 * retracement AND a round number is a far stronger reference than any one of them alone; that
 * agreement is the single most useful thing to hand a trader out of the scattered level blocks the
 * scan produces. Pure: it clusters a flat list of `{price, source}` levels and keeps only the
 * clusters where two or more DISTINCT methods land together.
 */
import type { Candle } from '../contracts'
import { detectPatterns, type PriceLevel, type TrendFit } from './pattern-detect'
import { fibRetracement, type FibRetracement } from './fib-retracement'
import { pivotPoints, type PivotPoints } from './pivot-points'
import { roundLevels, type RoundLevels } from './round-levels'
import { detectFairValueGaps, type FairValueGap } from './fair-value-gaps'
import { detectOrderBlocks, type OrderBlock } from './order-blocks'
import { detectStructureBreak, type StructureBreak } from './structure-breaks'
import { volumeProfile, type VolumeProfile } from './volume-profile'
import { sessionVwap, type SessionVwap } from './vwap-analysis'
import { toolNumber } from '../tool-number'

export interface SourcedLevel {
  price: number
  /** The METHOD family — confluence is counted across these, so two Fibonacci ratios landing
   *  together are NOT confluence (same method), a fib + a pivot IS. */
  method: string
  /** Human tag for display, e.g. `pivot R1`, `fib 61.8`, `round 300`. */
  label: string
}

export interface ConfluenceZone {
  /** Cluster center (mean of its members' prices). */
  price: number
  /** The distinct methods agreeing here, in ascending price order of first appearance. */
  sources: string[]
  /** Signed percent distance from the reference price (positive = above). */
  distancePct: number
}

/**
 * Confluence zones near `price`: cluster the levels within `tolerance` (a fraction of price) and
 * keep those where ≥2 DISTINCT sources agree, nearest first. `maxZones` caps the output so the
 * report stays tight.
 */
export function detectConfluence(
  levels: SourcedLevel[],
  price: number,
  tolerance = 0.0015,
  maxZones = 4,
): ConfluenceZone[] {
  if (!(price > 0)) return []
  const sorted = [...levels]
    .filter((l) => Number.isFinite(l.price))
    .sort((a, b) => a.price - b.price)
  const clusters: SourcedLevel[][] = []
  for (const level of sorted) {
    const last = clusters.at(-1)
    // A cluster extends while each new level is within tolerance of the cluster's FIRST price —
    // so a long chain of barely-adjacent levels can't drift into one giant blob.
    if (last && Math.abs(level.price - last[0]!.price) <= last[0]!.price * tolerance) {
      last.push(level)
    } else {
      clusters.push([level])
    }
  }
  const zones: ConfluenceZone[] = []
  for (const cluster of clusters) {
    // Confluence requires ≥2 distinct METHODS, not just 2 levels (two fib ratios ≠ confluence).
    if (new Set(cluster.map((l) => l.method)).size < 2) continue
    const sources = [...new Set(cluster.map((l) => l.label))]
    const center = cluster.reduce((s, l) => s + l.price, 0) / cluster.length
    zones.push({ price: center, sources, distancePct: ((center - price) / price) * 100 })
  }
  return zones.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct)).slice(0, maxZones)
}

/** Flatten the computed level methods into one `{price, source}` list — the ONE place the source
 *  tags are minted, shared by the detect handler and the client-side chart read. */
export function buildSourcedLevels(parts: {
  levels?: readonly PriceLevel[]
  fib?: FibRetracement | null
  pivots?: PivotPoints | null
  round?: RoundLevels | null
  /** SMC fair value gaps — each contributes its midpoint (the gap's equilibrium / CE). */
  fvgs?: readonly FairValueGap[]
  /** SMC order blocks — each contributes its midpoint (the zone a retest reacts in). */
  orderBlocks?: readonly OrderBlock[]
  /** A structure break — its flipped swing level is a reference the market defends or rejects. */
  structureBreak?: StructureBreak | null
  /** Volume profile — the POC and value-area edges are volume-based S/R. */
  volume?: VolumeProfile | null
  /** Session VWAP — the intraday benchmark; its midline is a magnet other methods can agree with. */
  vwap?: SessionVwap | null
}): SourcedLevel[] {
  const out: SourcedLevel[] = []
  for (const l of parts.levels ?? [])
    out.push({
      price: l.price,
      method: 'S/R',
      label: l.kind === 'support' ? 'S/R support' : 'S/R resistance',
    })
  if (parts.round) {
    out.push(
      { price: parts.round.below, method: 'round', label: `round ${parts.round.below}` },
      { price: parts.round.above, method: 'round', label: `round ${parts.round.above}` },
    )
  }
  if (parts.fib) {
    for (const l of parts.fib.levels)
      out.push({ price: l.price, method: 'fib', label: `fib ${(l.ratio * 100).toFixed(1)}` })
  }
  if (parts.pivots) {
    const p = parts.pivots
    out.push(
      { price: p.pp, method: 'pivot', label: 'pivot PP' },
      { price: p.r1, method: 'pivot', label: 'pivot R1' },
      { price: p.r2, method: 'pivot', label: 'pivot R2' },
      { price: p.s1, method: 'pivot', label: 'pivot S1' },
      { price: p.s2, method: 'pivot', label: 'pivot S2' },
    )
  }
  for (const g of parts.fvgs ?? [])
    out.push({
      price: g.mid,
      method: 'fvg',
      label: `FVG ${g.direction === 'bullish' ? 'demand' : 'supply'}`,
    })
  for (const b of parts.orderBlocks ?? [])
    out.push({
      price: b.mid,
      method: 'orderblock',
      label: `OB ${b.direction === 'bullish' ? 'demand' : 'supply'}`,
    })
  if (parts.structureBreak) {
    const b = parts.structureBreak
    out.push({ price: b.level, method: 'structure', label: `${b.type} level` })
  }
  if (parts.volume) {
    const v = parts.volume
    out.push(
      { price: v.poc, method: 'volume', label: 'volume POC' },
      { price: v.vah, method: 'volume', label: 'volume VAH' },
      { price: v.val, method: 'volume', label: 'volume VAL' },
    )
  }
  if (parts.vwap) out.push({ price: parts.vwap.vwap, method: 'vwap', label: 'session VWAP' })
  return out
}

/**
 * Confluence zones computed straight from the candles — the convenience for callers (the client
 * chart read) that don't already hold the level pieces. Recomputes the methods, so the detect
 * handler, which HAS them, builds its sources inline instead. `trend` orients the Fibonacci; when
 * omitted it is derived from the candles.
 */
export function confluenceFromCandles(
  candles: Candle[],
  trend?: TrendFit['direction'] | null,
): ConfluenceZone[] {
  const price = candles.at(-1)?.close
  // Fewer bars than this and the level methods are reading a micro-swing — any "agreement" is
  // noise, so there is no honest confluence to report (matches the regime classifier's floor).
  if (price === undefined || candles.length < 8) return []
  const report = detectPatterns(candles)
  const sourced = buildSourcedLevels({
    levels: report.levels,
    fib: fibRetracement(candles, trend ?? report.trend?.direction ?? null),
    pivots: pivotPoints(candles),
    round: roundLevels(price),
    fvgs: detectFairValueGaps(candles),
    orderBlocks: detectOrderBlocks(candles),
    structureBreak: detectStructureBreak(candles),
    volume: volumeProfile(candles),
    vwap: sessionVwap(candles),
  })
  return detectConfluence(sourced, price)
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** Within this percent of a confluence zone, price is effectively AT it — a live decision point. */
const AT_ZONE_PCT = 0.15

/** Whether price is sitting ON one of these zones — the single-source test the summary and the
 *  confluence render both use, so "AT confluence" means the same thing in both. */
export function isAtConfluence(zones: ConfluenceZone[]): boolean {
  return zones.some((z) => Math.abs(z.distancePct) <= AT_ZONE_PCT)
}

/** Confluence zones as report lines — the strongest evidence a level matters, or nothing. When
 *  price is sitting ON one, that is called out first: it is the most actionable state (a reaction
 *  — bounce or break — is likely right here). */
export function renderConfluence(zones: ConfluenceZone[]): string[] {
  if (zones.length === 0) return []
  const at = zones.find((z) => Math.abs(z.distancePct) <= AT_ZONE_PCT)
  const lines: string[] = []
  if (at) {
    lines.push(
      `- AT a confluence zone NOW (${toolNumber(at.price)}: ${at.sources.join(' + ')}) — expect a reaction (bounce or break); this is the decision point.`,
    )
  }
  lines.push('- confluence (levels where multiple methods agree — the strongest references):')
  for (const z of zones) {
    lines.push(
      `    · ${toolNumber(z.price)} (${z.distancePct >= 0 ? '+' : ''}${toolNumber(z.distancePct)}%): ${z.sources.join(' + ')}`,
    )
  }
  return lines
}
