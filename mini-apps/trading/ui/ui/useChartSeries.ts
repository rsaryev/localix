/**
 * The main price series and the chart's appearance: chart-type swap, market decimals, the main
 * scale's mode, the theme palette and the session background.
 */
import { useEffect } from 'react'
import { ColorType, PriceScaleMode, createSeriesMarkers } from 'lightweight-charts'
import { saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { seriesMarkersOf } from '../model/chartDrawings'
import {
  addMainSeries,
  mainSeriesData,
  mainSeriesOptions,
  saveChartType,
  type ChartType,
} from '../model/chartType'
import { canvasColorResolver, normalizeColor } from '../model/cssColor'
import { toVolumeData } from '../model/candleSeries'
import type { ChartPriceFormat } from '../model/formatQuote'
import type { ChartScaleMode } from '../model/indicatorPrefs'
import { syncDrawingLayer } from './useChartDrawings'
import type { ChartRuntime } from './useChartRuntime'

/** Global preference: shade the trading sessions (Asia/London/NY) as a chart background. */
export const SESSION_HIGHLIGHT_KEY = 'localix.trading.sessionHighlight'

/**
 * A theme token, in a syntax the chart can parse. Our tokens are `oklch()`; lightweight-charts'
 * own parser handles only hex / rgb / hsl / named colours and THROWS on anything else, taking the
 * chart down from inside the price-axis renderer. `normalizeColor` asks the browser instead.
 */
function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return normalizeColor(v, fallback, canvasColorResolver)
}

/** The chart palette from theme CSS vars (re-read whenever the theme flips). */
function readChartColors() {
  return {
    // The chart paints NO ground of its own: its pane already painted `--background`, and under
    // the host's glass theme that token carries alpha — a second coat would compound it.
    background: 'rgba(0, 0, 0, 0)',
    text: readVar('--text-soft', '#a1a1a1'),
    grid: readVar('--border', '#1f1f1f'),
    border: readVar('--border', '#1f1f1f'),
    up: readVar('--status-success', '#26a69a'),
    down: readVar('--status-error', '#ef5350'),
  }
}

/**
 * Mount (or SWAP) the main price series whenever the chart type changes — a full remove + add +
 * setData (the kinds are different renderers; a swap is rare). The viewport lives on the chart, so
 * it survives. The market's decimals are applied to the SERIES so a precision change never
 * rebuilds the chart.
 */
export function useChartMainSeries(
  rt: ChartRuntime,
  chartType: ChartType,
  priceFormat: ChartPriceFormat,
): void {
  useEffect(() => {
    const chart = rt.chart.current
    if (!chart) return
    saveChartType(chartType, rt.props.current.controlKey)
    if (rt.mainSeries.current) chart.removeSeries(rt.mainSeries.current)
    const series = addMainSeries(chart, chartType, rt.volumeColors.current)
    series.applyOptions({ priceFormat: { type: 'price', ...rt.props.current.priceFormat } })
    series.setData(mainSeriesData(chartType, rt.candles.current) as never[])
    rt.write('mainSeries', series)
    // Drawings and the trade-marker mini app lived ON the removed series — re-attach them.
    rt.drawingLayer.attach(series)
    syncDrawingLayer(rt, rt.drawings.current)
    rt.write('markersPlugin', createSeriesMarkers(series, seriesMarkersOf(rt.drawings.current)))
    rt.publish({ chartType })
  }, [rt, chartType])

  useEffect(() => {
    rt.mainSeries.current?.applyOptions({ priceFormat: { type: 'price', ...priceFormat } })
  }, [rt, priceFormat])
}

const SCALE_MODE: Record<ChartScaleMode, PriceScaleMode> = {
  linear: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percentage: PriceScaleMode.Percentage,
}

export function useChartAppearance(
  rt: ChartRuntime,
  theme: 'dark' | 'light',
  scaleMode: ChartScaleMode,
  sessionHighlight: boolean,
): void {
  // The MAIN scale's mode. Indicator panes keep their own — a fixed-range RSI stays linear.
  useEffect(() => {
    rt.chart.current?.priceScale('right').applyOptions({ mode: SCALE_MODE[scaleMode] })
    rt.publish({ scaleMode })
  }, [rt, scaleMode])

  useEffect(() => {
    rt.sessionPrim.current?.setEnabled(sessionHighlight)
    saveJSON(SESSION_HIGHLIGHT_KEY, sessionHighlight ? true : null)
  }, [rt, sessionHighlight])

  // Re-read from CSS vars on every flip — the `theme` dep fires after `data-theme` is stamped.
  useEffect(() => {
    const chart = rt.chart.current
    if (!chart) return
    const colors = readChartColors()
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        panes: { separatorColor: colors.border, separatorHoverColor: colors.text },
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { borderColor: colors.border },
    })
    rt.mainSeries.current?.applyOptions(
      mainSeriesOptions(rt.chartType.current, { up: colors.up, down: colors.down }),
    )
    // Volume colors ride on each point, so a flip re-sets them wholesale.
    rt.write('volumeColors', { up: colors.up, down: colors.down })
    rt.volumeSeries.current?.setData(toVolumeData(rt.candles.current, rt.volumeColors.current))
  }, [rt, theme])
}
