import type { ChartCommandPayload } from './chart-command'
import { detectDrawPayloads } from './analysis/detect-report'
import type { detectPatterns } from './analysis/pattern-detect'
import { fibDrawPayloads, type fibRetracement } from './analysis/fib-retracement'
import { fvgDrawPayloads, type detectFairValueGaps } from './analysis/fair-value-gaps'
import { orderBlockDrawPayloads, type detectOrderBlocks } from './analysis/order-blocks'
import { structureBreakDrawPayloads, type detectStructureBreak } from './analysis/structure-breaks'
import type { volumeProfile } from './analysis/volume-profile'
import type { sessionVwap } from './analysis/vwap-analysis'

export interface DetectDrawSources {
  connectionId: string
  symbol: string
  report: ReturnType<typeof detectPatterns>
  structureBreak: ReturnType<typeof detectStructureBreak>
  volProfile: ReturnType<typeof volumeProfile>
  vwap: ReturnType<typeof sessionVwap>
  fvgs: ReturnType<typeof detectFairValueGaps>
  orderBlocks: ReturnType<typeof detectOrderBlocks>
  fib: ReturnType<typeof fibRetracement>
}

/**
 * Every overlay a detect scan could draw, ordered HIGH-signal first so the caller's cap sheds the
 * most redundant overlays, not the best ones: the structure flip and the volume POC, then the SMC
 * imbalance zones, then the fib pocket, and finally the raw pattern S/R + trend.
 */
export function detectAutoDrawPayloads({
  connectionId,
  symbol,
  report,
  structureBreak,
  volProfile,
  vwap,
  fvgs,
  orderBlocks,
  fib,
}: DetectDrawSources): ChartCommandPayload[] {
  return [
    // The structure break as a dashed line at the flipped swing level.
    ...structureBreakDrawPayloads(connectionId, symbol, structureBreak),
    // The volume Point of Control — the single most-traded price, a strong magnet.
    ...(volProfile
      ? [
          {
            action: 'draw' as const,
            connectionId: connectionId,
            symbol: symbol,
            drawMode: 'add' as const,
            drawing: {
              kind: 'hline' as const,
              id: 'vol-poc',
              price: volProfile.poc,
              color: '#e0a458',
              lineStyle: 'dotted' as const,
              label: 'POC',
            },
          },
        ]
      : []),
    // Session VWAP — the intraday benchmark, a must-see line, drawn high-priority.
    ...(vwap
      ? [
          {
            action: 'draw' as const,
            connectionId: connectionId,
            symbol: symbol,
            drawMode: 'add' as const,
            drawing: {
              kind: 'hline' as const,
              id: 'vwap-mid',
              price: vwap.vwap,
              color: '#a78bfa',
              lineStyle: 'solid' as const,
              label: 'VWAP',
            },
          },
        ]
      : []),
    // The unfilled fair value gaps as shaded demand/supply zones.
    ...fvgDrawPayloads(connectionId, symbol, fvgs),
    // The unmitigated order blocks — the SMC retest zones, same visual language.
    ...orderBlockDrawPayloads(connectionId, symbol, orderBlocks),
    // The key fib levels — quiet dashed lines, stable ids, confluence-merged.
    ...(fib ? fibDrawPayloads(connectionId, symbol, fib) : []),
    // The volume value area as a faint band — the fair-value zone. Ranked below the
    // high-signal overlays so the auto-draw cap self-limits it (shows on a quiet chart,
    // shed on a busy one) rather than adding to the clutter.
    ...(volProfile
      ? [
          {
            action: 'draw' as const,
            connectionId: connectionId,
            symbol: symbol,
            drawMode: 'add' as const,
            drawing: {
              kind: 'zone' as const,
              id: 'vol-va',
              price1: volProfile.val,
              price2: volProfile.vah,
              color: '#e0a458',
              label: 'Value area',
            },
          },
        ]
      : []),
    // Raw pattern S/R + trend last — fills whatever the cap leaves.
    ...detectDrawPayloads(connectionId, symbol, report),
  ]
}
