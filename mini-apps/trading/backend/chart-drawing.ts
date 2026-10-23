/**
 * The DRAWING half of the `manage_chart` wire contract — the shapes an `action:'draw'` command
 * carries and a snapshot reply lists back. Sibling of `chart-command.ts` and held to the same
 * rules: pure types + structural guards + formatting only, importable from both the backend tool
 * and the UI (the UI's reducers/persistence live in `ui/model/chartDrawings.ts`).
 */
import { isoFromUnixSeconds } from './tool-number'

export const CHART_DRAW_MODES = ['add', 'remove', 'clear'] as const
export type ChartDrawMode = (typeof CHART_DRAW_MODES)[number]

export const DRAWING_KINDS = ['hline', 'trendline', 'vline', 'marker', 'zone'] as const

/** Which way a trade MARKER points: a buy draws an up arrow below the bar, a sell a down
 *  arrow above it — lightweight-charts' native series markers, the entry/exit vocabulary. */
export const MARKER_SIDES = ['buy', 'sell'] as const
export type MarkerSide = (typeof MARKER_SIDES)[number]

export const DRAWING_LINE_STYLES = ['solid', 'dashed', 'dotted'] as const
export type DrawingLineStyle = (typeof DRAWING_LINE_STYLES)[number]

/**
 * The ONE color rule every chart-facing color obeys — drawings, indicator overrides, prefs.
 * Hex only, because lightweight-charts' own parser THROWS on anything else (a named or oklch
 * color takes the chart down from inside the renderer). Lives here, in the pure contract, so
 * the tool's fix-it, the wire guards and the UI's prefs migration cannot drift apart.
 */
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
/** Deliberately NOT a `value is string` predicate: negating one on an already-`string` value
 *  narrows the false branch to `never`, which is a lie — a non-hex string is exactly what the
 *  fix-it paths there have to report. Callers narrow with `typeof` and ask this the rule. */
export const isHexColor = (value: unknown): boolean =>
  typeof value === 'string' && HEX_COLOR_RE.test(value)

interface DrawingBase {
  /** Canonical drawing id (`d1`, `d2`, … or agent-chosen). OPTIONAL on the wire — the UI
   *  assigns the next free auto id when absent; an existing id makes the add an upsert. */
  id?: string
  /** Hex CSS color (`#rrggbb`, optionally `#rgb`/`#rrggbbaa`) — the tool's fix-it enforces hex
   *  because lightweight-charts' own parser throws on anything fancier. */
  color?: string
  lineStyle?: DrawingLineStyle
  label?: string
}

export type ChartDrawingSpec =
  | (DrawingBase & { kind: 'hline'; price: number })
  | (DrawingBase & {
      kind: 'trendline'
      /** Endpoints in unix SECONDS + price, first point → second point. */
      time1: number
      price1: number
      time2: number
      price2: number
    })
  | (DrawingBase & { kind: 'vline'; time: number })
  /** A trade marker on the candles (an agent showing a fill or historical entry/exit).
   *  `time` is unix SECONDS; `price` is the RECORDED fill price — informational (named in the
   *  list/snapshot), the arrow itself rides the bar. `label` becomes the marker's text. */
  | (DrawingBase & { kind: 'marker'; time: number; side: MarkerSide; price?: number })
  /** A horizontal PRICE band — a supply/demand zone, drawn as a shaded region between two prices
   *  across the full width (it extends forward in time, the way a zone is watched). `price1`/
   *  `price2` are the edges in any order. */
  | (DrawingBase & { kind: 'zone'; price1: number; price2: number })

/** A drawing as the chart HOLDS it — the UI has assigned the id. */
export type ChartDrawing = ChartDrawingSpec & { id: string }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const optional = (v: unknown, ok: boolean) => v === undefined || ok
const optString = (v: unknown) => optional(v, typeof v === 'string' && (v as string).length > 0)

/** Structural guard for one drawing as it comes off the wire — malformed → null, never a throw. */
export function parseChartDrawingSpec(data: unknown): ChartDrawingSpec | null {
  if (typeof data !== 'object' || data === null) return null
  const p = data as Record<string, unknown>
  if (!optString(p.id)) return null
  if (!optString(p.color)) return null
  if (!optional(p.label, typeof p.label === 'string')) return null
  if (
    !optional(
      p.lineStyle,
      typeof p.lineStyle === 'string' &&
        (DRAWING_LINE_STYLES as readonly string[]).includes(p.lineStyle),
    )
  ) {
    return null
  }
  switch (p.kind) {
    case 'hline':
      return finite(p.price) ? (p as unknown as ChartDrawingSpec) : null
    case 'trendline':
      return finite(p.time1) && finite(p.price1) && finite(p.time2) && finite(p.price2)
        ? (p as unknown as ChartDrawingSpec)
        : null
    case 'vline':
      return finite(p.time) ? (p as unknown as ChartDrawingSpec) : null
    case 'marker':
      return finite(p.time) &&
        (MARKER_SIDES as readonly string[]).includes(p.side as string) &&
        optional(p.price, finite(p.price))
        ? (p as unknown as ChartDrawingSpec)
        : null
    case 'zone':
      return finite(p.price1) && finite(p.price2) ? (p as unknown as ChartDrawingSpec) : null
    default:
      return null
  }
}

/** One drawing in a result's words — used by the tool narration AND the snapshot read-back. */
export function describeChartDrawing(d: ChartDrawingSpec): string {
  const extras = [
    d.label ? `"${d.label}"` : null,
    d.lineStyle && d.lineStyle !== 'solid' ? d.lineStyle : null,
    d.id ? `id ${d.id}` : null,
  ].filter((x): x is string => x !== null)
  const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : ''
  switch (d.kind) {
    case 'hline':
      return `horizontal line @ ${d.price}${suffix}`
    case 'trendline':
      return `trendline ${isoFromUnixSeconds(d.time1)} @ ${d.price1} → ${isoFromUnixSeconds(d.time2)} @ ${d.price2}${suffix}`
    case 'vline':
      return `vertical line @ ${isoFromUnixSeconds(d.time)}${suffix}`
    case 'marker':
      return `${d.side} marker @ ${isoFromUnixSeconds(d.time)}${d.price !== undefined ? ` @ ${d.price}` : ''}${suffix}`
    case 'zone':
      return `zone ${Math.min(d.price1, d.price2)}–${Math.max(d.price1, d.price2)}${suffix}`
  }
}
