/**
 * SERVER-SIDE indicator readings over service candles — the agent's numbers WITHOUT a mounted
 * chart tab. `manage_chart action:'snapshot'` reads what the open chart computed; this module
 * answers the same question from raw OHLCV, so "what is the RSI" no longer requires the user to
 * be looking at the market.
 *
 * ONE math, two surfaces: the computation is NOT re-implemented here — it calls the chart's own
 * catalog (`ui/model/indicatorSpecs.ts` → `ui/model/indicators.ts`), which is runtime-pure
 * (type-only lightweight-charts imports, no DOM, no React), so the number the human reads off
 * the legend is byte-identical to the number the agent reasons from. If that module ever grows a
 * runtime chart dependency, extract the math down — never fork it.
 *
 * Honesty rules inherited from the chart: a plot with no full lookback window emits NO value
 * (never a warped partial), and the report SAYS how many bars the window had — `ema:200` over 30
 * candles is "insufficient bars", not 0.
 */
import type { Candle } from './contracts'
import { INDICATOR_FORMS, indicatorId, indicatorLabel, parseIndicatorId } from './indicator-spec'
import { indicatorSpecFor } from '../ui/model/indicatorSpecs'
import { toolNumber } from './tool-number'

/** One indicator's latest computed values, in the snapshot's vocabulary. */
export interface IndicatorReading {
  /** Canonical id (`ema:200`) — the same token `manage_chart` commands the chart with. */
  id: string
  /** Human label naming the parameters (`EMA 200`, `MACD (12, 26, 9)`). */
  label: string
  /** Latest value per plot key (`{k: 71.2, d: 65.8}`). A key with no full lookback window is
   *  ABSENT — the caller renders "insufficient bars", never a number. */
  plots: Record<string, number>
}

export interface IndicatorReadings {
  readings: IndicatorReading[]
  /** Spellings that parse as no indicator at all — reported back as a fix-it, never dropped. */
  unknown: string[]
}

/**
 * The latest reading for ONE spelling, or null when it names no indicator. `volume` is built
 * into the chart (no spec); its honest reading is the newest bar's own volume — absent when the
 * venue reported none.
 */
export function indicatorReading(rawId: string, candles: Candle[]): IndicatorReading | null {
  const params = parseIndicatorId(rawId)
  if (!params) return null
  const id = indicatorId(params)
  const label = indicatorLabel(params)
  if (params.kind === 'volume') {
    const v = candles.at(-1)?.volume
    return { id, label, plots: v === undefined ? {} : { volume: v } }
  }
  const spec = indicatorSpecFor(params)
  if (!spec) return { id, label, plots: {} }
  const data = spec.compute(candles)
  const plots: Record<string, number> = {}
  for (const s of spec.series) {
    const last = (data[s.key] ?? []).at(-1)
    if (last && typeof last.value === 'number' && Number.isFinite(last.value)) {
      plots[s.key] = last.value
    }
  }
  return { id, label, plots }
}

/** Readings for a whole request: canonical-deduped, order-preserving, unknowns reported. */
export function computeIndicatorReadings(
  rawIds: readonly string[],
  candles: Candle[],
): IndicatorReadings {
  const readings: IndicatorReading[] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const raw of rawIds) {
    const reading = indicatorReading(raw, candles)
    if (!reading) {
      unknown.push(raw)
      continue
    }
    if (seen.has(reading.id)) continue
    seen.add(reading.id)
    readings.push(reading)
  }
  return { readings, unknown }
}

/**
 * The indicator block for a `market_data` symbol read — computed over the SAME candles the tool
 * just printed, and it says so (the window IS the lookback; there is no hidden longer history).
 */
export function indicatorLines(
  rawIds: readonly string[],
  candles: Candle[],
  timeframe: string,
): string[] {
  const { readings, unknown } = computeIndicatorReadings(rawIds, candles)
  const lines: string[] = []
  if (readings.length > 0) {
    lines.push(
      `  indicators (computed over the ${candles.length}×${timeframe} candles above — the same math the chart draws):`,
    )
    for (const r of readings) {
      const plots = Object.entries(r.plots)
      const reading =
        plots.length === 0
          ? `  (insufficient bars for a full lookback window — request more \`candles\`)`
          : plots.length === 1
            ? ` = ${toolNumber(plots[0]![1])}`
            : `: ${plots.map(([key, v]) => `${key}=${toolNumber(v)}`).join(', ')}`
      lines.push(`    - ${r.label} (${r.id})${reading}`)
    }
  }
  if (unknown.length > 0) {
    lines.push(
      `  (unknown indicator spec(s): ${unknown.map((u) => `"${u}"`).join(', ')}. Accepted forms: ${INDICATOR_FORMS})`,
    )
  }
  return lines
}
