/**
 * The `action:'detect'` PRESENTATION + draw-command layer: pure folds from a
 * {@link ./pattern-detect.PatternReport} to (a) the text block the model reads — numbers
 * always — and (b) the standard `draw` wire payloads that SHOW the findings on the chart.
 *
 * Drawing ids are STABLE (`pat-s1`, `pat-r1`, `pat-trend`): an add with a known id replaces, so
 * a re-detect refreshes its own overlay instead of stacking a new one per call, and the shared
 * per-tab drawing cap is never eaten by repetition.
 */
import type { ChartCommandPayload } from '../chart-command'
import type { ChartDrawingSpec } from '../chart-drawing'
import type { CandleFlag, PatternReport, PriceLevel } from './pattern-detect'
import { isoFromUnixSeconds, toolNumber } from '../tool-number'
import { BEARISH_COLOR, BULLISH_COLOR } from './draw-colors'

/** Distinct-on-both-themes accents: support / resistance / trend (from the chart palette). */
const TREND_COLOR = '#6aa8ff'

/** Below this fit quality a drawn trendline would be an invented line — reported, not drawn. */
const TREND_DRAW_MIN_R2 = 0.3

/** Four significant digits without exponent noise (the house tool-number rule). */
const flagLabel: Record<CandleFlag['pattern'], string> = {
  doji: 'doji (indecision)',
  hammer: 'hammer (potential reversal up)',
  inverted_hammer: 'inverted hammer (potential reversal up after a down leg)',
  shooting_star: 'shooting star (potential reversal down)',
  spinning_top: 'spinning top (indecision)',
  bullish_engulfing: 'bullish engulfing',
  bearish_engulfing: 'bearish engulfing',
  bullish_harami: 'bullish harami (inside bar after a down body — momentum stalling)',
  bearish_harami: 'bearish harami (inside bar after an up body — momentum stalling)',
  piercing_line: 'piercing line (bullish reversal — closed above the prior midpoint)',
  dark_cloud_cover: 'dark cloud cover (bearish reversal — closed below the prior midpoint)',
  morning_star: 'morning star (three-bar bullish reversal)',
  evening_star: 'evening star (three-bar bearish reversal)',
  three_white_soldiers: 'three white soldiers (strong continuation up)',
  three_black_crows: 'three black crows (strong continuation down)',
}

/** The findings in the result's words — every claim with its numbers, honest about weak fits. */
export function renderPatternReport(
  report: PatternReport,
  symbol: string,
  timeframe: string,
  barCount: number,
): string {
  const lines: string[] = [
    `Pattern scan for ${symbol} over the last ${barCount}×${timeframe} candles (simple counting methods — pivots, least squares, body/wick ratios; an entry point for analysis, not a signal):`,
  ]
  if (report.regime) {
    lines.push(
      `- regime: ${report.regime.kind.toUpperCase()} (confidence ${report.regime.confidence.toFixed(2)}) — ${report.regime.note}`,
    )
  }
  const supports = report.levels.filter((l) => l.kind === 'support')
  const resistances = report.levels.filter((l) => l.kind === 'resistance')
  const levelLine = (l: PriceLevel) =>
    `  - ${l.kind} @ ${toolNumber(l.price)} (${l.touches} pivot touch${l.touches === 1 ? '' : 'es'}, last ${isoFromUnixSeconds(l.lastTouch)})`
  if (supports.length > 0) {
    lines.push('- support levels (strongest first):', ...supports.map(levelLine))
  }
  if (resistances.length > 0) {
    lines.push('- resistance levels (strongest first):', ...resistances.map(levelLine))
  }
  if (report.levels.length === 0)
    lines.push('- no clustered support/resistance pivots in this window')
  if (report.trend) {
    const t = report.trend
    lines.push(
      `- trend: ${t.direction} (${(t.pctPerBar * 100).toFixed(3)}% per bar, r² ${t.r2.toFixed(2)}` +
        `${t.r2 < TREND_DRAW_MIN_R2 ? ' — a WEAK fit; treat as noise' : ''})`,
    )
  }
  if (report.flags.length > 0) {
    lines.push(
      `- candlestick flags on the newest bar(s): ${report.flags.map((f) => `${flagLabel[f.pattern]} @ ${isoFromUnixSeconds(f.time)}`).join('; ')}`,
    )
  }
  return lines.join('\n')
}

/**
 * The findings as standard `draw` commands: dashed hlines per level (labelled with its touch
 * count), a dotted trendline for a non-flat, non-noise fit. Stable `pat-*` ids replace on
 * re-detect. At most 3+3 levels + 1 trendline — far inside the per-tab drawing cap.
 */
export function detectDrawPayloads(
  connectionId: string,
  symbol: string,
  report: PatternReport,
): ChartCommandPayload[] {
  const drawings: ChartDrawingSpec[] = []
  let s = 0
  let r = 0
  for (const level of report.levels) {
    const id = level.kind === 'support' ? `pat-s${++s}` : `pat-r${++r}`
    drawings.push({
      kind: 'hline',
      id,
      price: level.price,
      color: level.kind === 'support' ? BULLISH_COLOR : BEARISH_COLOR,
      lineStyle: 'dashed',
      label: `${level.kind[0]!.toUpperCase()}${level.kind.slice(1)} ×${level.touches}`,
    })
  }
  const t = report.trend
  if (t && t.direction !== 'flat' && t.r2 >= TREND_DRAW_MIN_R2) {
    drawings.push({
      kind: 'trendline',
      id: 'pat-trend',
      time1: t.start.time,
      price1: t.start.price,
      time2: t.end.time,
      price2: t.end.price,
      color: TREND_COLOR,
      lineStyle: 'dotted',
      label: `trend ${t.direction}`,
    })
  }
  return drawings.map((drawing) => ({
    action: 'draw',
    connectionId,
    symbol,
    drawMode: 'add',
    drawing,
  }))
}
