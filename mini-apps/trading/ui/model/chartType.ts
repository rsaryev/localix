import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  LineSeries,
  type AreaData,
  type BarData,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesPartialOptionsMap,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { CHART_TYPES, type ChartTypeToken } from '../../backend/chart-command'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { StorageReader, StorageWriter } from '@localixai/mini-app-sdk/ui/storage'

/**
 * How the price series is DRAWN — candles (default), line, area, or OHLC bars. Pure state +
 * mapping module: the reducer, the per-type series definition/options/data mappers, and the
 * persisted preference (per tab like the indicator set and drawings — how a trader draws price can
 * differ market to market). The canvas stays a generic engine that swaps the main series when this
 * value changes.
 */

export type ChartType = ChartTypeToken
export { CHART_TYPES }

export const DEFAULT_CHART_TYPE: ChartType = 'candles'

/** Tolerant spelling → chart type; null for anything else. */
export function normalizeChartType(value: unknown): ChartType | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if ((CHART_TYPES as readonly string[]).includes(v)) return v as ChartType
  if (v === 'candle' || v === 'candlestick' || v === 'candlesticks') return 'candles'
  if (v === 'bar' || v === 'ohlc') return 'bars'
  return null
}

/**
 * The reducer: a requested value (agent command, stored pref, menu click) against the current
 * one. Unknown requests keep the current type — a bad command must never blank the chart.
 */
export function reduceChartType(current: ChartType, requested: unknown): ChartType {
  return normalizeChartType(requested) ?? current
}

/** The union of series APIs the price can be drawn as; the canvas holds ONE of these. */
export type MainSeriesApi = ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'>

/** Mount the main price series for `type` (v5: `chart.addSeries(<Definition>, options)`). */
export function addMainSeries(
  chart: IChartApi,
  type: ChartType,
  colors: { up: string; down: string },
): MainSeriesApi {
  // Each branch's options object is built FOR that branch's type; the assertion only tells the
  // compiler what the switch already guarantees.
  switch (type) {
    case 'candles':
      return chart.addSeries(
        CandlestickSeries,
        mainSeriesOptions(type, colors) as SeriesPartialOptionsMap['Candlestick'],
      )
    case 'bars':
      return chart.addSeries(
        BarSeries,
        mainSeriesOptions(type, colors) as SeriesPartialOptionsMap['Bar'],
      )
    case 'line':
      return chart.addSeries(
        LineSeries,
        mainSeriesOptions(type, colors) as SeriesPartialOptionsMap['Line'],
      )
    case 'area':
      return chart.addSeries(
        AreaSeries,
        mainSeriesOptions(type, colors) as SeriesPartialOptionsMap['Area'],
      )
  }
}

/** The fixed accent line/area charts draw in (an indicator-style accent, legible on both themes —
 *  up/down green/red is candle semantics, not a single line's). */
export const LINE_CHART_COLOR = '#6aa8ff'

export type MainSeriesOptions =
  | SeriesPartialOptionsMap['Candlestick']
  | SeriesPartialOptionsMap['Bar']
  | SeriesPartialOptionsMap['Line']
  | SeriesPartialOptionsMap['Area']

/** Theme/type-appropriate options for the main series (applied on create AND on theme flips —
 *  {@link MainSeriesApi} carries the union type, whose `applyOptions` accepts this union). */
export function mainSeriesOptions(
  type: ChartType,
  colors: { up: string; down: string },
): MainSeriesOptions {
  switch (type) {
    case 'candles':
      return {
        borderVisible: false,
        upColor: colors.up,
        downColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
      }
    case 'bars':
      return { upColor: colors.up, downColor: colors.down }
    case 'line':
      return { color: LINE_CHART_COLOR, lineWidth: 2 }
    case 'area':
      return {
        lineColor: LINE_CHART_COLOR,
        lineWidth: 2,
        topColor: `${LINE_CHART_COLOR}44`,
        bottomColor: `${LINE_CHART_COLOR}00`,
      }
  }
}

export type MainSeriesPoint = CandlestickData | BarData | LineData | AreaData

/** One bar in the shape the mounted series type consumes (line/area read the close). */
export function mainSeriesPoint(type: ChartType, bar: Candle): MainSeriesPoint {
  const time = bar.time as UTCTimestamp
  if (type === 'line' || type === 'area') return { time, value: bar.close }
  return { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }
}

/** The whole history in the mounted series type's shape. */
export function mainSeriesData(type: ChartType, candles: Candle[]): MainSeriesPoint[] {
  return candles.map((bar) => mainSeriesPoint(type, bar))
}

/**
 * Persisted PER TAB (`localix.trading.chartType:<tabId>`), keyed like the indicator set and
 * drawings; a chart without a tab id uses the bare key. Best-effort; unknown values ignored on
 * load.
 */
const PREFS_KEY = 'localix.trading.chartType'
const tabPrefsKey = (tabId: string) => `${PREFS_KEY}:${tabId}`

/**
 * The chart type for a tab, or the default when none is stored.
 */
export function loadChartType(tabId?: string, storage?: StorageReader): ChartType {
  const key = tabId ? tabPrefsKey(tabId) : PREFS_KEY
  return normalizeChartType(loadJSON<unknown>(key, storage)) ?? DEFAULT_CHART_TYPE
}

export function saveChartType(type: ChartType, tabId?: string, storage?: StorageWriter): void {
  saveJSON(tabId ? tabPrefsKey(tabId) : PREFS_KEY, type, storage)
}
