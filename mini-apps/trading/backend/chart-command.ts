/**
 * The WIRE CONTRACT between the `manage_chart` agent tool (backend) and the trading UI's command
 * sink — the one payload shape both sides compile against. Route B: the tool emits it as a typed,
 * REPLAYABLE `mini-app.command` stream frame (`context.session.emitCommand` → `mini-app.command` →
 * `miniAppCommandBus`), keyed by {@link TRADING_MINI_APP} + {@link TRADING_CHART_CHANNEL}; the UI
 * sink parses it back with {@link parseChartCommandPayload} because the envelope's payload is
 * `unknown`-typed by design.
 *
 * Pure types + guards only — no zod, no chart, no service — so the UI can import it the same way
 * it imports `./contracts`.
 */

export const TRADING_MINI_APP = 'trading'
export const TRADING_CHART_CHANNEL = 'chart'

import {
  CHART_DRAW_MODES,
  isHexColor,
  parseChartDrawingSpec,
  type ChartDrawMode,
  type ChartDrawingSpec,
} from './chart-drawing'

export const CHART_ACTIONS = [
  'open',
  'set_timeframe',
  'set_indicators',
  'set_chart_type',
  'navigate',
  // Drawings/overlays: add/remove/clear hline / trendline / vline (see chart-drawing.ts).
  'draw',
  // Per-indicator visuals (visibility / color / fixed range) and the price scale's mode —
  // how the chart READS, not which indicators are on (that stays `set_indicators`).
  'configure',
  // READ-ONLY round-trip: the sink answers with the tab's current state (see
  // chart-snapshot.ts for the reply contract) and must NOT open/focus anything.
  'snapshot',
] as const
export type ChartAction = (typeof CHART_ACTIONS)[number]

export const CHART_TYPES = ['candles', 'line', 'area', 'bars'] as const
export type ChartTypeToken = (typeof CHART_TYPES)[number]

export const INDICATOR_MODES = ['set', 'add', 'remove', 'clear'] as const
export type IndicatorMode = (typeof INDICATOR_MODES)[number]

export const NAVIGATE_OPS = ['to_realtime', 'to_time', 'zoom_in', 'zoom_out', 'fit'] as const
export type NavigateOp = (typeof NAVIGATE_OPS)[number]

/** The MAIN price scale's mode. Indicator panes keep their own (see `configure` range fields). */
export const SCALE_MODES = ['linear', 'log', 'percentage'] as const
export type ScaleModeToken = (typeof SCALE_MODES)[number]

/** For `configure`: what to change about how the chart reads. Every field independent. */
export interface ChartConfigure {
  /** The CANONICAL indicator id the visual fields target; absent = scale-mode-only. */
  indicator?: string
  /** Show/hide the indicator without removing it (it keeps its pane and settings). */
  visible?: boolean
  /** Hex color override for the indicator's primary plot. */
  color?: string
  /** Fixed pane range. Both or neither; `rangeMin < rangeMax` (the tool validates). */
  rangeMin?: number
  rangeMax?: number
  /** Clear any fixed range (including the indicator's natural one, e.g. RSI's 0–100). */
  rangeAuto?: boolean
  /** The main price scale's mode. */
  scaleMode?: ScaleModeToken
}

export interface ChartCommandPayload {
  action: ChartAction
  /** The RESOLVED connection (the tool already applied the public-venue default). */
  connectionId: string
  /** Unified market symbol — with connectionId it IS the chart tab's identity. */
  symbol: string
  /** For set_timeframe (and optionally alongside open). */
  timeframe?: string
  /** For set_indicators (and optionally alongside open): CANONICAL ids (`ema:200`, `bb:20:2`). */
  indicators?: string[]
  indicatorsMode?: IndicatorMode
  /** For set_chart_type (and optionally alongside open). */
  chartType?: ChartTypeToken
  /** For navigate. */
  navigate?: NavigateOp
  /** For navigate=to_time: unix SECONDS of the bar to center on. */
  time?: number
  /** For draw. */
  drawMode?: ChartDrawMode
  /** For draw with drawMode=add: the validated drawing (times already folded to seconds). */
  drawing?: ChartDrawingSpec
  /** For draw with drawMode=remove: which drawing to delete. */
  drawingId?: string
  /** For configure: the validated visual changes (indicator id already canonical). */
  configure?: ChartConfigure
}

const oneOf = <T extends string>(v: unknown, all: readonly T[]): v is T =>
  typeof v === 'string' && (all as readonly string[]).includes(v)

const optional = (v: unknown, ok: boolean) => v === undefined || ok

/**
 * Structural guard for the payload as it comes OFF the command envelope. Anything malformed
 * (an old build, a foreign emitter on the same mini app/channel key) is dropped as null — the sink
 * must never crash the stream router.
 */
export function parseChartCommandPayload(data: unknown): ChartCommandPayload | null {
  if (typeof data !== 'object' || data === null) return null
  const p = data as Record<string, unknown>
  if (!oneOf(p.action, CHART_ACTIONS)) return null
  if (typeof p.connectionId !== 'string' || p.connectionId.length === 0) return null
  if (typeof p.symbol !== 'string' || p.symbol.length === 0) return null
  if (!optional(p.timeframe, typeof p.timeframe === 'string')) return null
  if (
    !optional(
      p.indicators,
      Array.isArray(p.indicators) && p.indicators.every((i) => typeof i === 'string'),
    )
  ) {
    return null
  }
  if (!optional(p.indicatorsMode, oneOf(p.indicatorsMode, INDICATOR_MODES))) return null
  if (!optional(p.chartType, oneOf(p.chartType, CHART_TYPES))) return null
  if (!optional(p.navigate, oneOf(p.navigate, NAVIGATE_OPS))) return null
  if (!optional(p.time, typeof p.time === 'number' && Number.isFinite(p.time))) return null
  if (!optional(p.drawMode, oneOf(p.drawMode, CHART_DRAW_MODES))) return null
  if (!optional(p.drawing, parseChartDrawingSpec(p.drawing) !== null)) return null
  if (!optional(p.drawingId, typeof p.drawingId === 'string' && p.drawingId.length > 0)) {
    return null
  }
  if (!optional(p.configure, parseChartConfigure(p.configure) !== null)) return null
  return p as unknown as ChartCommandPayload
}

/** Structural guard for the `configure` block — every field independently optional. */
export function parseChartConfigure(data: unknown): ChartConfigure | null {
  if (typeof data !== 'object' || data === null) return null
  const c = data as Record<string, unknown>
  if (!optional(c.indicator, typeof c.indicator === 'string' && c.indicator.length > 0)) return null
  if (!optional(c.visible, typeof c.visible === 'boolean')) return null
  // Hex only (the drawing contract's shared rule): lightweight-charts' own color parser THROWS
  // on anything else, taking the chart down from inside the renderer.
  if (!optional(c.color, isHexColor(c.color))) return null
  if (!optional(c.rangeMin, typeof c.rangeMin === 'number' && Number.isFinite(c.rangeMin)))
    return null
  if (!optional(c.rangeMax, typeof c.rangeMax === 'number' && Number.isFinite(c.rangeMax)))
    return null
  if (!optional(c.rangeAuto, typeof c.rangeAuto === 'boolean')) return null
  if (!optional(c.scaleMode, oneOf(c.scaleMode, SCALE_MODES))) return null
  return c as unknown as ChartConfigure
}
