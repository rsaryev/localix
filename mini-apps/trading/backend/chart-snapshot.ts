/**
 * The REPLY half of the `manage_chart` wire contract — what the trading UI sink answers to an
 * `action:'snapshot'` command (over the `mini-app-command-result` WS RPC, correlated by the frame's
 * commandId). Sibling of `chart-command.ts` and held to the same rules: pure types + structural
 * guards + formatting only, importable from both the backend tool and the UI sink.
 */

import type { ChartTypeToken, ScaleModeToken } from './chart-command'
import { CHART_TYPES, SCALE_MODES } from './chart-command'
import { describeChartDrawing, parseChartDrawingSpec, type ChartDrawing } from './chart-drawing'
import { indicatorLabel, parseIndicatorId } from './indicator-spec'
import { isoFromUnixSeconds, toolNumber } from './tool-number'

export interface ChartSnapshotResult {
  /** False = the tab is not on screen; the rest is last-known/preference state, not live. */
  mounted: boolean
  connectionId: string
  symbol: string
  timeframe?: string
  chartType?: ChartTypeToken
  /** Active indicators as CANONICAL ids (`ema:200`, `bb:20:2`). */
  indicators?: string[]
  /** The subset of `indicators` currently hidden — mounted but not drawn. */
  hiddenIndicators?: string[]
  /**
   * The COMPUTED value of every indicator plot at the newest bar, `id → plotKey → value`
   * (`{'rsi:14': {line: 63.2}}`). Only a MOUNTED chart has computed anything — the values come
   * from the chart's own per-tick compute, so they are exactly what the user is looking at.
   */
  indicatorValues?: Record<string, Record<string, number>>
  /** The main price scale's mode. */
  scaleMode?: ScaleModeToken
  /** Drawings on the chart (each with its assigned id) — present only when there are any. */
  drawings?: ChartDrawing[]
  /** Visible time range, unix SECONDS (only a mounted chart has a viewport). */
  visibleRange?: { from: number; to: number }
  /** Newest bar the mounted chart holds — time (unix seconds) + close. */
  lastCandle?: { time: number; close: number }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const optional = (v: unknown, ok: boolean) => v === undefined || ok

/** Structural guard for the reply as it comes off the WS RPC — malformed → null, never a throw. */
export function parseChartSnapshotResult(data: unknown): ChartSnapshotResult | null {
  if (typeof data !== 'object' || data === null) return null
  const p = data as Record<string, unknown>
  if (typeof p.mounted !== 'boolean') return null
  if (typeof p.connectionId !== 'string' || p.connectionId.length === 0) return null
  if (typeof p.symbol !== 'string' || p.symbol.length === 0) return null
  if (!optional(p.timeframe, typeof p.timeframe === 'string')) return null
  if (
    !optional(
      p.chartType,
      typeof p.chartType === 'string' && (CHART_TYPES as readonly string[]).includes(p.chartType),
    )
  ) {
    return null
  }
  if (
    !optional(
      p.indicators,
      Array.isArray(p.indicators) && p.indicators.every((i) => typeof i === 'string'),
    )
  ) {
    return null
  }
  if (
    !optional(
      p.hiddenIndicators,
      Array.isArray(p.hiddenIndicators) && p.hiddenIndicators.every((i) => typeof i === 'string'),
    )
  ) {
    return null
  }
  if (
    !optional(
      p.indicatorValues,
      typeof p.indicatorValues === 'object' &&
        p.indicatorValues !== null &&
        Object.values(p.indicatorValues).every(
          (plots) =>
            typeof plots === 'object' &&
            plots !== null &&
            Object.values(plots).every((v) => finite(v)),
        ),
    )
  ) {
    return null
  }
  if (
    !optional(
      p.scaleMode,
      typeof p.scaleMode === 'string' && (SCALE_MODES as readonly string[]).includes(p.scaleMode),
    )
  ) {
    return null
  }
  if (
    !optional(
      p.drawings,
      Array.isArray(p.drawings) &&
        p.drawings.every((d) => {
          const spec = parseChartDrawingSpec(d)
          return spec !== null && typeof spec.id === 'string'
        }),
    )
  ) {
    return null
  }
  const range = p.visibleRange as Record<string, unknown> | undefined
  if (!optional(range, !!range && finite(range.from) && finite(range.to))) return null
  const last = p.lastCandle as Record<string, unknown> | undefined
  if (!optional(last, !!last && finite(last.time) && finite(last.close))) return null
  return p as unknown as ChartSnapshotResult
}

/** Four significant digits, without exponent noise — RSI's 63.2 and a BTC price both read. */
/**
 * One indicator's line: its label, its canonical id (the token to command it with), its computed
 * value(s) when the chart has any, and whether it is hidden. A single-plot indicator reads
 * `= 63.2`; a multi-plot one names each plot, because "MACD = −12.4" hides the signal and the
 * histogram — the two halves a crossover is actually read from.
 */
function describeIndicator(
  id: string,
  values: Record<string, number> | undefined,
  hidden: boolean,
): string {
  const params = parseIndicatorId(id)
  const label = params ? indicatorLabel(params) : id
  const plots = Object.entries(values ?? {})
  const reading =
    plots.length === 0
      ? // A mounted chart with no value = the indicator has no full lookback window yet.
        ''
      : plots.length === 1
        ? ` = ${toolNumber(plots[0]![1])}`
        : `: ${plots.map(([key, v]) => `${key}=${toolNumber(v)}`).join(', ')}`
  return `  - ${label} (${id})${reading}${hidden ? ' — hidden' : ''}`
}

/** The snapshot in the tool result's words — honest about what is live vs last-known. */
export function describeChartSnapshot(snap: ChartSnapshotResult, venueName: string): string {
  const lines: string[] = []
  lines.push(
    snap.mounted
      ? `Chart state for ${snap.symbol} on ${venueName} (tab is open):`
      : `The ${snap.symbol} chart tab on ${venueName} is NOT open — remembered preferences only ` +
          '(what it would open with; nothing was opened):',
  )
  if (snap.timeframe) lines.push(`- timeframe: ${snap.timeframe}`)
  if (snap.chartType) lines.push(`- chart type: ${snap.chartType}`)
  // Non-linear scaling changes what the SHAPE of the chart means, so it is never silent.
  if (snap.scaleMode && snap.scaleMode !== 'linear') {
    lines.push(`- price scale: ${snap.scaleMode}`)
  }
  if (snap.indicators && snap.indicators.length > 0) {
    const hidden = new Set(snap.hiddenIndicators ?? [])
    lines.push('- indicators:')
    for (const id of snap.indicators) {
      lines.push(describeIndicator(id, snap.indicatorValues?.[id], hidden.has(id)))
    }
  } else {
    lines.push('- indicators: none')
  }
  if (snap.drawings && snap.drawings.length > 0) {
    lines.push(`- drawings: ${snap.drawings.map((d) => describeChartDrawing(d)).join('; ')}`)
  }
  if (snap.visibleRange) {
    lines.push(
      `- visible range: ${isoFromUnixSeconds(snap.visibleRange.from)} → ${isoFromUnixSeconds(snap.visibleRange.to)}`,
    )
  }
  if (snap.lastCandle) {
    lines.push(
      `- last candle: ${isoFromUnixSeconds(snap.lastCandle.time)} close ${snap.lastCandle.close}`,
    )
  }
  return lines.join('\n')
}
