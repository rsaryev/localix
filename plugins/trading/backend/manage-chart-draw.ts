/**
 * The `action:'draw'` slice of the `manage_chart` model-facing contract: the flat zod fields
 * (spread into `manage-chart-schema.ts`'s object — house style keeps per-action params as
 * optional siblings), the required-field fix-its the flat schema cannot express, and the
 * input → wire-drawing fold. Split out so the schema file stays at its size; same rules apply:
 * every lesson about misuse lands here as a tolerance or a fix-it, never in the tool body.
 */
import { z } from 'zod'
import {
  CHART_DRAW_MODES,
  DRAWING_KINDS,
  DRAWING_LINE_STYLES,
  MARKER_SIDES,
  isHexColor,
  type ChartDrawingSpec,
} from './chart-drawing'

/** Cap on shapes per batched draw — matches the chart's own drawing ceiling, so a batch can fill
 *  the board in one call but never claim to draw more than the chart keeps. */
export const MAX_BATCH_DRAWINGS = 24

export const drawInputFields = {
  draw_mode: z
    .enum(CHART_DRAW_MODES)
    .optional()
    .describe(
      'For action=draw: `add` (default) adds a drawing (or REPLACES the one whose drawing_id you pass); ' +
        '`remove` deletes one by drawing_id; `clear` removes all drawings from the chart.',
    ),
  drawing_kind: z
    .enum(DRAWING_KINDS)
    .optional()
    .describe(
      'For action=draw with draw_mode=add: `hline` is a horizontal price line (needs `price`); `trendline` a ' +
        'segment between two points (needs `time`+`price` and `time2`+`price2`); `vline` a vertical time ' +
        'marker (needs `time`, unix seconds); `marker` a trade arrow ON the candles (needs `time` + `side`; ' +
        '`price` records the fill price, `label` shows at the arrow); `zone` a shaded price band ' +
        '(supply/demand — needs `price`+`price2`, the two edges) — use markers to show fills or ' +
        'historical entries/exits.',
    ),
  side: z
    .enum(MARKER_SIDES)
    .optional()
    .describe(
      'For action=draw with drawing_kind=marker: which way the trade went — `buy` draws an up arrow below ' +
        'the bar, `sell` a down arrow above it. Required for markers.',
    ),
  drawing_id: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "The drawing's id. With draw_mode=add it names (or replaces) the drawing; omitted, the chart assigns " +
        '`d1`, `d2`, … (action=snapshot lists drawings with their ids). Required for draw_mode=remove.',
    ),
  price: z
    .number()
    .optional()
    .describe(
      "For action=draw: the hline's price level, the trendline's FIRST point price (with `time`), or the " +
        "marker's recorded fill price (optional, informational).",
    ),
  price2: z
    .number()
    .optional()
    .describe(
      "For action=draw with drawing_kind=trendline: the SECOND point's price (with `time2`).",
    ),
  time2: z
    .number()
    .optional()
    .describe(
      "For action=draw with drawing_kind=trendline: the SECOND point's unix time (seconds; milliseconds are " +
        'auto-detected).',
    ),
  color: z
    .string()
    .optional()
    .describe(
      "Hex color like `#f0a13a`. For action=draw: the drawing's color (defaults to a legible accent). " +
        "For action=configure: the `indicator`'s primary line color. Hex only — a named or oklch color " +
        'is rejected.',
    ),
  line_style: z
    .enum(DRAWING_LINE_STYLES)
    .optional()
    .describe('For action=draw: solid (default), dashed, or dotted.'),
  label: z
    .string()
    .max(64)
    .optional()
    .describe('For action=draw: short text shown with the drawing (hline shows it at the line).'),
  drawings: z
    .array(
      z.object({
        drawing_kind: z.enum(DRAWING_KINDS),
        drawing_id: z.string().min(1).max(64).optional(),
        price: z.number().optional(),
        price2: z.number().optional(),
        time: z.number().optional(),
        time2: z.number().optional(),
        side: z.enum(MARKER_SIDES).optional(),
        color: z.string().optional(),
        line_style: z.enum(DRAWING_LINE_STYLES).optional(),
        label: z.string().max(64).optional(),
      }),
    )
    .max(MAX_BATCH_DRAWINGS)
    .optional()
    .describe(
      'For action=draw with draw_mode=add: draw MANY shapes in ONE call — an array where each item ' +
        'has the same fields as a single draw (`drawing_kind` plus its required points/price/time, and ' +
        'optional `drawing_id`/`color`/`line_style`/`label`). Prefer this over calling the tool once per ' +
        `shape: pass all your levels, zones, trendlines and markers together (up to ${MAX_BATCH_DRAWINGS}). ` +
        'When present, the top-level single-drawing fields are ignored. Each item with a `drawing_id` ' +
        'replaces that id; without one it gets a fresh `d<n>`.',
    ),
}

/** One element of a batched `drawings` array — a single add-drawing, no mode of its own. */
export interface DrawItemSlice {
  drawing_kind: (typeof DRAWING_KINDS)[number]
  drawing_id?: string
  price?: number
  price2?: number
  time?: number
  time2?: number
  side?: (typeof MARKER_SIDES)[number]
  color?: string
  line_style?: (typeof DRAWING_LINE_STYLES)[number]
  label?: string
}

/** The slice of ManageChartInput the draw path reads (shared `time` doubles as the first point). */
export interface DrawInputSlice {
  draw_mode?: (typeof CHART_DRAW_MODES)[number]
  drawing_kind?: (typeof DRAWING_KINDS)[number]
  drawing_id?: string
  price?: number
  price2?: number
  time?: number
  time2?: number
  side?: (typeof MARKER_SIDES)[number]
  color?: string
  line_style?: (typeof DRAWING_LINE_STYLES)[number]
  label?: string
  /** Batch: many add-drawings in one call. When present, the single-drawing fields are ignored. */
  drawings?: DrawItemSlice[]
}

/** Required-field fix-its for ONE add-drawing (a single call or a batch item). Null when valid. */
function drawItemProblem(item: DrawItemSlice): string | null {
  if (!item.drawing_kind) {
    return `a drawing needs a "drawing_kind" (one of: ${DRAWING_KINDS.join(', ')}).`
  }
  if (item.color !== undefined && !isHexColor(item.color)) {
    return `"${item.color}" is not a hex color. Use a form like "#f0a13a" (or #rgb / #rrggbbaa).`
  }
  if (item.drawing_kind === 'hline' && item.price === undefined) {
    return 'drawing_kind="hline" needs a "price" — the level to draw the horizontal line at.'
  }
  if (item.drawing_kind === 'trendline') {
    const missing = (['time', 'price', 'time2', 'price2'] as const).filter(
      (k) => item[k] === undefined,
    )
    if (missing.length > 0) {
      return `drawing_kind="trendline" needs two points: "time"+"price" and "time2"+"price2" (missing: ${missing.join(', ')}).`
    }
    if (item.time === item.time2) {
      return 'drawing_kind="trendline" needs two DISTINCT times — for a vertical marker use drawing_kind="vline".'
    }
  }
  if (item.drawing_kind === 'vline' && item.time === undefined) {
    return 'drawing_kind="vline" needs a "time" — the unix time (seconds) to mark.'
  }
  if (item.drawing_kind === 'marker') {
    if (item.time === undefined) {
      return 'drawing_kind="marker" needs a "time" — the unix time (seconds) of the bar to mark.'
    }
    if (item.side === undefined) {
      return 'drawing_kind="marker" needs a "side" — `buy` (up arrow below the bar) or `sell` (down arrow above it).'
    }
  }
  if (item.drawing_kind === 'zone') {
    if (item.price === undefined || item.price2 === undefined) {
      return 'drawing_kind="zone" needs two prices — "price" and "price2", the band edges (a supply/demand zone).'
    }
    if (item.price === item.price2) {
      return 'drawing_kind="zone" needs two DISTINCT prices — for a single level use drawing_kind="hline".'
    }
  }
  return null
}

/** Required-field fix-its for action=draw. Null when the call is well-formed. */
export function drawProblem(input: DrawInputSlice): string | null {
  const mode = input.draw_mode ?? 'add'
  if (mode === 'clear') return null
  if (mode === 'remove') {
    return input.drawing_id
      ? null
      : 'draw_mode="remove" needs a "drawing_id" — action="snapshot" lists the chart\'s drawings with their ids.'
  }
  // Batch add: validate each item, naming the one that is wrong. `remove`/`clear` are single-op.
  if (input.drawings !== undefined) {
    if (input.drawings.length === 0) {
      return 'the "drawings" array is empty — pass at least one drawing, or use the single-drawing fields.'
    }
    for (let i = 0; i < input.drawings.length; i++) {
      const problem = drawItemProblem(input.drawings[i]!)
      if (problem) return `drawings[${i}]: ${problem}`
    }
    return null
  }
  // Single add.
  if (!input.drawing_kind) {
    return `action="draw" needs a "drawing_kind" (one of: ${DRAWING_KINDS.join(', ')}), the "drawings" array for a batch, or draw_mode="remove"/"clear".`
  }
  return drawItemProblem(input as DrawItemSlice)
}

/** Unix milliseconds are ~1.7e12; anything past this is treated as ms and folded to seconds. */
const MS_THRESHOLD = 100_000_000_000

/** Fold a unix time that may have arrived in milliseconds down to seconds. */
export function foldUnixSeconds(time: number): number {
  return time > MS_THRESHOLD ? Math.round(time / 1000) : time
}

/**
 * A VALIDATED draw add → the wire drawing. Times are folded to seconds; the id (when given)
 * rides along so the UI upserts instead of duplicating.
 */
export function buildChartDrawing(input: DrawInputSlice): ChartDrawingSpec | null {
  if ((input.draw_mode ?? 'add') !== 'add' || !input.drawing_kind) return null
  const base = {
    ...(input.drawing_id ? { id: input.drawing_id } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.line_style ? { lineStyle: input.line_style } : {}),
    ...(input.label ? { label: input.label } : {}),
  }
  switch (input.drawing_kind) {
    case 'hline':
      return { kind: 'hline', price: input.price ?? 0, ...base }
    case 'trendline':
      return {
        kind: 'trendline',
        time1: foldUnixSeconds(input.time ?? 0),
        price1: input.price ?? 0,
        time2: foldUnixSeconds(input.time2 ?? 0),
        price2: input.price2 ?? 0,
        ...base,
      }
    case 'vline':
      return { kind: 'vline', time: foldUnixSeconds(input.time ?? 0), ...base }
    case 'marker':
      return {
        kind: 'marker',
        time: foldUnixSeconds(input.time ?? 0),
        side: input.side ?? 'buy',
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...base,
      }
    case 'zone':
      return { kind: 'zone', price1: input.price ?? 0, price2: input.price2 ?? 0, ...base }
  }
}

/**
 * A VALIDATED draw add → the wire drawings. A batch (`drawings` array) folds each item; a single
 * call folds the top-level fields into a one-element array. Empty (a non-add mode, or nothing
 * drawable) → `[]`. Callers emit one `draw`/`add` command per element.
 */
export function buildChartDrawings(input: DrawInputSlice): ChartDrawingSpec[] {
  if ((input.draw_mode ?? 'add') !== 'add') return []
  if (input.drawings !== undefined) {
    return input.drawings
      .map((item) => buildChartDrawing(item))
      .filter((d): d is ChartDrawingSpec => d !== null)
  }
  const one = buildChartDrawing(input)
  return one ? [one] : []
}
