/**
 * The MODEL-FACING CONTRACT of `manage_chart`: the flat Zod schema (per-action params as optional
 * siblings — no nested unions, so the mirror stays provider-compatible), and the required-field
 * guards the flat schema cannot express, answered as fix-it messages. Mirrors
 * `manage-orders-schema.ts` / browser-input.ts: every lesson about how models misuse the
 * tool lands here as a tolerance or a fix-it, never in the tool body.
 */
import { z } from 'zod'
import {
  CHART_ACTIONS,
  CHART_TYPES,
  INDICATOR_MODES,
  NAVIGATE_OPS,
  SCALE_MODES,
  type ChartCommandPayload,
  type ChartConfigure,
} from './chart-command'
import { INDICATOR_FORMS, normalizeIndicatorId } from './indicator-spec'
import { isHexColor } from './chart-drawing'
import {
  buildChartDrawing,
  drawInputFields,
  drawProblem,
  foldUnixSeconds,
} from './manage-chart-draw'

/** The wire actions plus `detect`, which is answered SERVER-SIDE (it never rides the command
 *  stream itself — only the draw commands it optionally spawns do). */
export const MANAGE_CHART_ACTIONS = [...CHART_ACTIONS, 'detect'] as const

export const manageChartInputSchema = z.object({
  action: z
    .enum(MANAGE_CHART_ACTIONS)
    .describe(
      "`open` opens (or focuses) the market's chart tab in the Trading workspace; `set_timeframe` switches its bar " +
        'size; `set_indicators` changes which indicators are drawn; `set_chart_type` switches the price rendering; ' +
        '`navigate` scrolls/zooms the viewport; `draw` adds/removes drawings (hline / trendline / vline / marker / zone); ' +
        "`configure` changes how the chart READS (an indicator's visibility / color / fixed range, or the " +
        "price scale's mode); `snapshot` READS the chart's current state back — including each indicator's " +
        'COMPUTED values (read-only — it never opens or changes the tab); `detect` runs the FULL technical scan ' +
        'server-side: regime, composite signal + suggested exposure, confluence zones, SMC (structure breaks, fair ' +
        'value gaps, order blocks, liquidity pools + sweep flag), volume profile, session VWAP, S/R levels, candle ' +
        'flags, divergence, gated Ichimoku, harmonic patterns, ATR/HV/VaR — and on a perp the funding positioning ' +
        'and order-book imbalance. Numbers always; the key zones drawn too with auto_draw=true.',
    ),
  connection_id: z
    .string()
    .optional()
    .describe(
      'The trading connection whose chart to control. Omit for the default public market-data venue. ' +
        'Call market_data with no arguments to list connections.',
    ),
  symbol: z
    .string()
    .min(1)
    .describe(
      'Unified market symbol, e.g. `BTC/USDC:USDC`. Together with the connection it IDENTIFIES the chart tab — ' +
        "every action targets (and opens, if needed) that market's chart. Required.",
    ),
  timeframe: z
    .string()
    .optional()
    .describe(
      'For action=set_timeframe (also honoured with action=open): the bar size, e.g. `1m`, `15m`, `1h`, `4h`, `1d`. ' +
        'Must be one the venue offers (market_data lists them). Case matters: `1m` is a minute, `1M` a month.',
    ),
  indicators: z
    .array(z.string())
    .max(12)
    .optional()
    .describe(
      'For action=set_indicators (also honoured with action=open): indicator specs — parameterized ids like ' +
        '`ema:200`, `sma:50`, `rsi:14`, `bb:20:2`, `macd:12:26:9`, `vwap`, `supertrend:10:3`, `stoch:14:3:3`, ' +
        '`atr:14`, `obv`, `adx:14`, or preset aliases like `sma20`/`bb20`/`st`/`dmi`. ' +
        'Bare kinds take defaults (`macd` = macd:12:26:9).',
    ),
  indicators_mode: z
    .enum(INDICATOR_MODES)
    .optional()
    .describe(
      'For action=set_indicators: `set` (default) REPLACES the active set with `indicators`; `add`/`remove` adjust ' +
        'it; `clear` removes all (needs no `indicators`).',
    ),
  chart_type: z
    .enum(CHART_TYPES)
    .optional()
    .describe(
      'For action=set_chart_type (also honoured with action=open): how price is drawn — candles (default), ' +
        'line, area, or bars (OHLC).',
    ),
  navigate: z
    .enum(NAVIGATE_OPS)
    .optional()
    .describe(
      'For action=navigate: `to_realtime` scrolls to the live edge, `to_time` centers on a moment (needs `time`), ' +
        '`zoom_in`/`zoom_out` halve/double the visible window, `fit` fits the loaded history.',
    ),
  time: z
    .number()
    .optional()
    .describe(
      'For action=navigate with navigate=to_time: the unix time (seconds; milliseconds are auto-detected) to ' +
        "center the viewport on. Only already-loaded history can be reached. For action=draw: the trendline's " +
        "FIRST point time, the vline's time, or the marker's bar time.",
    ),
  indicator: z
    .string()
    .optional()
    .describe(
      'For action=configure: WHICH indicator the visual fields below target — the same spec form as ' +
        '`indicators` (`rsi:14`, `ema:200`). It must already be on the chart (snapshot lists what is). ' +
        'Omit to configure only the price scale (`scale_mode`).',
    ),
  visible: z
    .boolean()
    .optional()
    .describe(
      'For action=configure with `indicator`: false HIDES the indicator without removing it — it keeps its ' +
        'pane, parameters and settings, and true brings it back. To take it off entirely use ' +
        'action=set_indicators with indicators_mode="remove".',
    ),
  // `color` is SHARED with action=draw (declared in drawInputFields, described for both) — the
  // flat schema keeps one field per concept, exactly as `time` serves navigate and draw.
  range_min: z
    .number()
    .optional()
    .describe(
      "For action=configure with `indicator`: the fixed LOW of the indicator pane's scale. Pass with " +
        '`range_max`. Pins the pane so its levels stay put (e.g. an RSI locked to 0-100). Pane indicators only.',
    ),
  range_max: z
    .number()
    .optional()
    .describe(
      "For action=configure with `indicator`: the fixed HIGH of the pane's scale. See `range_min`.",
    ),
  range_auto: z
    .boolean()
    .optional()
    .describe(
      'For action=configure with `indicator`: true clears any fixed range so the pane autoscales to the data — ' +
        "including the indicator's own natural range (RSI/Stochastic default to 0-100).",
    ),
  scale_mode: z
    .enum(SCALE_MODES)
    .optional()
    .describe(
      "For action=configure: the MAIN price scale's mode — `linear` (default), `log` (equal % moves get equal " +
        'height — how a long, wide-range history is read), or `percentage` (each series relative to its first ' +
        'visible bar). Indicator panes keep their own scales.',
    ),
  auto_draw: z
    .boolean()
    .optional()
    .describe(
      'For action=detect: true also DRAWS the findings on the chart — dashed hlines per level (labelled with ' +
        'the touch count) and a dotted trendline for a non-noise fit — with stable `pat-*` drawing ids a ' +
        're-detect replaces. Default false (text/numbers only).',
    ),
  detail: z
    .enum(['full', 'compact'])
    .optional()
    .describe(
      'For action=detect: "compact" answers with the decision core (summary, confluence, structure, ' +
        'composite signal, volatility, higher-timeframe alignment) plus any LIVE event (a liquidity sweep, ' +
        'price inside an FVG/order block, a gated ichimoku, a completed harmonic, a vol squeeze, crowded ' +
        'funding) — a fraction of the full report. Use it for repeated re-scans mid-conversation; the first ' +
        'scan of a market deserves "full" (the default).',
    ),
  ...drawInputFields,
})

export type ManageChartInput = z.infer<typeof manageChartInputSchema>

/** `1h` / `15m` / `1M` / `3d` — a count and a unit letter. Loose on purpose: the venue's own
 *  list is the real gate (the UI validates against it); this only catches obvious non-timeframes. */
const TIMEFRAME_RE = /^\d{1,4}[a-zA-Z]$/

/**
 * Required-field guards the flat schema cannot express. Returns a fix-it message, or null when
 * the call is well-formed — failing fast here beats a command the UI silently drops.
 */
export function manageChartProblem(input: ManageChartInput): string | null {
  if (
    input.action === 'set_timeframe' ||
    (input.timeframe !== undefined && (input.action === 'open' || input.action === 'detect'))
  ) {
    if (input.action === 'set_timeframe' && !input.timeframe) {
      return 'action="set_timeframe" needs a "timeframe", e.g. "15m", "1h", "4h", "1d".'
    }
    if (input.timeframe && !TIMEFRAME_RE.test(input.timeframe)) {
      return `"${input.timeframe}" is not a timeframe. Use a count + unit like "1m", "15m", "1h", "4h", "1d", "1w", "1M".`
    }
  }
  if (input.action === 'set_indicators') {
    const mode = input.indicators_mode ?? 'set'
    if (mode !== 'clear' && !input.indicators?.length) {
      return `action="set_indicators" needs "indicators" (or indicators_mode="clear" to remove all). Accepted forms: ${INDICATOR_FORMS}.`
    }
  }
  if (input.indicators) {
    const bad = input.indicators.filter((id) => normalizeIndicatorId(id) === null)
    if (bad.length > 0) {
      return `Unknown indicator spec(s): ${bad.map((b) => `"${b}"`).join(', ')}. Accepted forms: ${INDICATOR_FORMS}.`
    }
  }
  if (input.action === 'set_chart_type' && !input.chart_type) {
    return `action="set_chart_type" needs a "chart_type" (one of: ${CHART_TYPES.join(', ')}).`
  }
  if (input.action === 'navigate') {
    if (!input.navigate) {
      return `action="navigate" needs a "navigate" op (one of: ${NAVIGATE_OPS.join(', ')}).`
    }
    if (input.navigate === 'to_time' && input.time === undefined) {
      return 'navigate="to_time" needs a "time" — the unix time (seconds) to center the chart on.'
    }
  }
  if (input.action === 'draw') return drawProblem(input)
  if (input.action === 'configure') return configureProblem(input)
  return null
}

/**
 * `configure`'s guards. The action does two independent things (an indicator's visuals, the price
 * scale's mode), so the first question is which one was actually asked for — a `configure` naming
 * neither is a no-op the UI would silently drop.
 */
function configureProblem(input: ManageChartInput): string | null {
  const visualFields =
    input.visible !== undefined ||
    input.color !== undefined ||
    input.range_min !== undefined ||
    input.range_max !== undefined ||
    input.range_auto !== undefined
  if (!input.indicator && !input.scale_mode) {
    return (
      'action="configure" needs either an "indicator" (with visible / color / range_min+range_max / range_auto) ' +
      `or a "scale_mode" (one of: ${SCALE_MODES.join(', ')}).`
    )
  }
  if (visualFields && !input.indicator) {
    return `action="configure" needs an "indicator" to apply those fields to. Accepted forms: ${INDICATOR_FORMS}.`
  }
  if (input.indicator) {
    if (normalizeIndicatorId(input.indicator) === null) {
      return `Unknown indicator spec: "${input.indicator}". Accepted forms: ${INDICATOR_FORMS}.`
    }
    if (!visualFields && !input.scale_mode) {
      return (
        `action="configure" named "${input.indicator}" but no change: pass visible, color, ` +
        'range_min+range_max, or range_auto.'
      )
    }
  }
  const hasMin = input.range_min !== undefined
  const hasMax = input.range_max !== undefined
  if (hasMin !== hasMax) {
    return 'A fixed range needs BOTH "range_min" and "range_max" (or "range_auto": true to clear it).'
  }
  if (hasMin && hasMax && input.range_min! >= input.range_max!) {
    return `"range_min" (${input.range_min}) must be BELOW "range_max" (${input.range_max}).`
  }
  if (hasMin && input.range_auto) {
    return 'Pass EITHER a fixed range (range_min + range_max) OR "range_auto": true — they are opposites.'
  }
  if (input.color !== undefined && !isHexColor(input.color)) {
    return `"${input.color}" is not a hex color. Use a form like "#6aa8ff" (or #rgb / #rrggbbaa).`
  }
  return null
}

/** A validated `configure` input → the wire block (indicator id already canonical). */
function buildChartConfigure(input: ManageChartInput): ChartConfigure {
  const indicator = input.indicator ? normalizeIndicatorId(input.indicator) : null
  return {
    ...(indicator ? { indicator } : {}),
    ...(input.visible !== undefined ? { visible: input.visible } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.range_min !== undefined ? { rangeMin: input.range_min } : {}),
    ...(input.range_max !== undefined ? { rangeMax: input.range_max } : {}),
    ...(input.range_auto !== undefined ? { rangeAuto: input.range_auto } : {}),
    ...(input.scale_mode ? { scaleMode: input.scale_mode } : {}),
  }
}

/**
 * A VALIDATED input → the wire payload the UI sink executes. Indicator spellings are normalized
 * to canonical ids here, so the UI never re-parses agent tolerance; `time` is folded to seconds.
 */
export function buildChartCommandPayload(
  input: ManageChartInput,
  connectionId: string,
): ChartCommandPayload {
  const indicators = input.indicators
    ?.map((id) => normalizeIndicatorId(id))
    .filter((id): id is string => id !== null)
  const dedup = indicators ? [...new Set(indicators)] : undefined
  const time = input.time !== undefined ? foldUnixSeconds(input.time) : undefined
  const drawing = input.action === 'draw' ? buildChartDrawing(input) : null
  return {
    // `detect` is answered server-side and never reaches this fold (the tool returns before
    // building a payload); the assertion keeps the WIRE enum closed to the sink's vocabulary.
    action: input.action as ChartCommandPayload['action'],
    connectionId,
    symbol: input.symbol,
    ...(input.timeframe ? { timeframe: input.timeframe } : {}),
    ...(dedup ? { indicators: dedup } : {}),
    ...(input.action === 'set_indicators'
      ? { indicatorsMode: input.indicators_mode ?? 'set' }
      : {}),
    ...(input.chart_type ? { chartType: input.chart_type } : {}),
    ...(input.navigate ? { navigate: input.navigate } : {}),
    // For draw, `time` is already folded INTO the drawing — the payload field is navigate's.
    ...(time !== undefined && input.action !== 'draw' ? { time } : {}),
    ...(input.action === 'draw' ? { drawMode: input.draw_mode ?? 'add' } : {}),
    ...(drawing ? { drawing } : {}),
    ...(input.action === 'draw' && input.drawing_id && (input.draw_mode ?? 'add') !== 'add'
      ? { drawingId: input.drawing_id }
      : {}),
    ...(input.action === 'configure' ? { configure: buildChartConfigure(input) } : {}),
  }
}
