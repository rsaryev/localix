import { z } from 'zod'
import {
  CHART_ACTIONS,
  CHART_TYPES,
  INDICATOR_MODES,
  NAVIGATE_OPS,
  SCALE_MODES,
} from './chart-command'
import { drawInputFields } from './manage-chart-draw'

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
