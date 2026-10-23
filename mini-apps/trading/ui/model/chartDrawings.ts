import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { StorageReader } from '@localixai/mini-app-sdk/ui/storage'
import {
  parseChartDrawingSpec,
  type ChartDrawMode,
  type ChartDrawing,
  type ChartDrawingSpec,
  type DrawingLineStyle,
} from '../../backend/chart-drawing'

/**
 * The chart's DRAWING state — pure reducers over the `manage_chart action:'draw'` commands, id
 * assignment, and per-TAB persistence. Unlike the indicator set / chart type (global: how a
 * trader reads price is how they read every chart), a drawing marks THIS market at THIS level —
 * so the store is keyed by the chart tab id (`tradingChartTabId(connectionId, symbol)`), the market
 * half of the identity `chartControlBus` and `chartStateStore` key on (they add the chat: their
 * state is live per chart tab, while a drawing marks the market in every chat).
 */

/** A chart holds at most this many drawings; an add past the cap drops the OLDEST first. */
export const MAX_DRAWINGS = 24

/**
 * Two hlines closer than this (relative) are ONE level: an add lands ON the existing line
 * instead of stacking a near-duplicate — the agent's hand-picked level and `detect`'s auto
 * level for the same structure collapse to a single line instead of a double label.
 */
export const HLINE_MERGE_TOLERANCE = 0.002

/** The default accent a drawing takes when the agent names no color (legible on both themes). */
export const DEFAULT_DRAWING_COLOR = '#f0a13a'

/** The stable id prefixes the `detect` auto-draw stamps its overlays with — pattern S/R + trend
 *  (`pat-`), Fibonacci (`fib-`), fair value gaps (`fvg-`), the structure break (`struct-`), the
 *  volume POC / value area (`vol-`) and session VWAP (`vwap-`). A hand-placed drawing takes a `d<n>`
 *  id and never one of these, so the two are always separable. */
export const DETECT_DRAWING_PREFIXES = ['pat-', 'fib-', 'fvg-', 'struct-', 'vol-', 'vwap-'] as const

/** Whether a drawing id belongs to the agent's `detect` auto-draw (versus a hand-placed drawing). */
export function isDetectDrawingId(id: string): boolean {
  return DETECT_DRAWING_PREFIXES.some((p) => id.startsWith(p))
}

/** The next free auto id: `d<n>` past the highest auto id already taken. Agent-chosen ids that
 *  don't match the `d<n>` shape never collide with (or advance) the counter. */
export function nextDrawingId(existing: readonly ChartDrawing[]): string {
  let max = 0
  for (const d of existing) {
    const m = /^d(\d+)$/.exec(d.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `d${max + 1}`
}

/**
 * Apply one draw command to the drawing list. Pure; always returns a NEW array (React state).
 * `add` with a known id REPLACES that drawing (idempotent under duplicate delivery — the bus
 * replays batches to late subscribers); without an id the next `d<n>` is assigned. A `remove`
 * with an unknown/absent id is a no-op, never an error — the drawing may already be gone.
 */
export function applyDrawCommand(
  current: readonly ChartDrawing[],
  mode: ChartDrawMode,
  drawing?: ChartDrawingSpec,
  id?: string,
): ChartDrawing[] {
  if (mode === 'clear') return []
  if (mode === 'remove') return current.filter((d) => d.id !== id)
  if (!drawing) return [...current]
  const withId: ChartDrawing = { ...drawing, id: drawing.id ?? nextDrawingId(current) }
  const at = current.findIndex((d) => d.id === withId.id)
  if (at >= 0) return current.map((d, i) => (i === at ? withId : d))
  // A NEW hline within merge tolerance of an existing one REPLACES it (newest wording wins) —
  // one line per price zone, whoever drew first.
  if (withId.kind === 'hline') {
    const near = current.findIndex(
      (d) =>
        d.kind === 'hline' &&
        Math.abs(d.price - withId.price) <= Math.abs(withId.price) * HLINE_MERGE_TOLERANCE,
    )
    if (near >= 0) return current.map((d, i) => (i === near ? withId : d))
  }
  return [...current, withId].slice(-MAX_DRAWINGS)
}

/**
 * The label as the LINE should wear it: without any trailing price tokens (`Support 255`,
 * `EMA 200 = 298.5`, `MA cluster ~263` → `Support`, `EMA 200`, `MA cluster`) — the axis and
 * crosshair already say where the line is, a price in the title is the double label the
 * screenshot mess was made of — and truncated to a badge-sized length.
 */
export function drawingTitle(label: string | undefined): string {
  if (!label) return ''
  let text = label.trim()
  // Strip the trailing PRICE-ish group ONCE (a decimal or 3+ digits, with its =/~/@ joiner) —
  // one pass so `EMA 200 = 298.5` keeps its parameter (`EMA 200`) and only loses the price;
  // small counters like a level's `×3` touch count are information, not a price, and stay.
  const stripped = text.replace(/[\s=~@]*\$?(?:\d+[.,]\d+|\d{3,})[\d.,]*%?$/, '').trimEnd()
  if (stripped.length > 0) text = stripped
  text = text.replace(/[\s=~@—-]+$/, '').trim()
  if (text.length === 0) text = label.trim()
  return text.length > 18 ? `${text.slice(0, 17)}…` : text
}

/**
 * Stored value → the drawing list. Structural guard entry-by-entry (a hand-edited or old-build
 * store drops the malformed entries, never the whole list); entries without an id — which the
 * reducer always assigns before saving — are dropped too, and duplicate ids keep the FIRST.
 */
export function migrateDrawings(raw: unknown): ChartDrawing[] {
  if (!Array.isArray(raw)) return []
  const out: ChartDrawing[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const spec = parseChartDrawingSpec(entry)
    if (!spec?.id || seen.has(spec.id)) continue
    seen.add(spec.id)
    out.push(spec as ChartDrawing)
  }
  return out.slice(-MAX_DRAWINGS)
}

/** Per-tab key: drawings mark one market's chart, not every chart. */
const prefsKey = (tabId: string) => `localix.trading.drawings:${tabId}`

export function loadDrawings(tabId: string, storage?: StorageReader): ChartDrawing[] {
  return migrateDrawings(loadJSON<unknown>(prefsKey(tabId), storage))
}

/** Best-effort persistence; an empty list REMOVES the key (no tombstones per market visited). */
export function saveDrawings(tabId: string, drawings: readonly ChartDrawing[]): void {
  saveJSON(prefsKey(tabId), drawings.length > 0 ? drawings : null)
}

/** Canvas dash pattern for a drawing's line style (media/CSS pixels). Pure — testable without
 *  a canvas; the primitives feed it straight to `ctx.setLineDash`. */
export function dashPattern(style: DrawingLineStyle | undefined): number[] {
  if (style === 'dashed') return [6, 4]
  if (style === 'dotted') return [2, 3]
  return []
}

/** Trade-marker default tints — the candle up/down convention, so a buy arrow reads as a buy. */
export const MARKER_BUY_COLOR = '#26a69a'
export const MARKER_SELL_COLOR = '#ef5350'

/**
 * The `marker` drawings as lightweight-charts NATIVE series markers, ascending by time (the
 * library requires the order). Pure — ChartCanvas hands the result straight to the
 * `createSeriesMarkers` mini app on the main series. A buy is an up arrow below the bar, a sell a
 * down arrow above it; an explicit drawing color wins over the side tint; the label rides as the
 * marker text. A marker whose time falls between bars snaps to the library's nearest-bar rule —
 * the recorded `price`/time stay exact in the drawing itself (list + snapshot).
 */
export function seriesMarkersOf(drawings: readonly ChartDrawing[]): SeriesMarker<Time>[] {
  return drawings
    .filter((d): d is Extract<ChartDrawing, { kind: 'marker' }> => d.kind === 'marker')
    .sort((a, b) => a.time - b.time)
    .map((d) => ({
      time: d.time as UTCTimestamp,
      position: d.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
      shape: d.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
      color: d.color ?? (d.side === 'buy' ? MARKER_BUY_COLOR : MARKER_SELL_COLOR),
      id: d.id,
      ...(d.label ? { text: d.label } : {}),
    }))
}
