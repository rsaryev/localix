/**
 * The MODEL-FACING CONTRACT of `manage_chart`: the flat Zod schema (per-action params as optional
 * siblings — no nested unions, so the mirror stays provider-compatible), and the required-field
 * guards the flat schema cannot express, answered as fix-it messages. Mirrors
 * `manage-orders-schema.ts` / browser-input.ts: every lesson about how models misuse the
 * tool lands here as a tolerance or a fix-it, never in the tool body.
 */
import {
  CHART_TYPES,
  NAVIGATE_OPS,
  SCALE_MODES,
  type ChartCommandPayload,
  type ChartConfigure,
} from './chart-command'
import { INDICATOR_FORMS, normalizeIndicatorId } from './indicator-spec'
import { isHexColor } from './chart-drawing'
import { buildChartDrawing, drawProblem, foldUnixSeconds } from './manage-chart-draw'

import type { ManageChartInput } from './manage-chart-input'

export { manageChartInputSchema, type ManageChartInput } from './manage-chart-input'

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
