/**
 * The shared imperative context of one chart canvas.
 *
 * lightweight-charts owns its series, scales and viewport; React does not. Every chart hook reaches
 * into that one object, and each must see what the previous one did WITHOUT a re-render — so the
 * chart, its series, and the latest props live here as ref boxes, created once per canvas and
 * handed to every hook. The ORDER of the hooks in `ChartCanvas` is the order their effects run in:
 * chart before series, series before data, data before the handlers that read it.
 */
import { useLayoutEffect, useState, type RefObject } from 'react'
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, Time } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import type { ChartDrawing } from '../../backend/chart-drawing'
import type { VolumeColors } from '../model/candleSeries'
import type { ChartType, MainSeriesApi } from '../model/chartType'
import { chartStateStore, type ChartTabState } from '../model/chartStateStore'
import type { ChartPriceFormat } from '../model/formatQuote'
import type { IndicatorSpec } from '../model/indicators'
import type { BandFillPrimitive } from './bandFillPrimitive'
import { createDrawingLayer } from './drawingLayer'
import type { SessionHighlightPrimitive } from './sessionHighlightPrimitive'

/** A mutable box — what `useRef` returns, without tying the runtime to a hook call per field. */
export type Box<T> = RefObject<T>

export type IndicatorValues = Record<string, Record<string, number>>

/** The props every hook reads through a ref, mirrored on each render. */
export interface ChartRuntimeProps {
  priceFormat: ChartPriceFormat
  controlKey: string | undefined
  controlSessionId: string | undefined
  onLoadOlder: (() => void) | undefined
  overlay: readonly ChartDrawing[]
}

export interface ChartRuntime {
  container: Box<HTMLDivElement | null>
  chart: Box<IChartApi | null>
  /** The MAIN price series — candles by default, swappable to line/area/bars. */
  mainSeries: Box<MainSeriesApi | null>
  volumeSeries: Box<ISeriesApi<'Histogram'> | null>
  drawingLayer: ReturnType<typeof createDrawingLayer>
  /** Native series-marker mini app on the main series (trade markers), recreated on a type swap. */
  markersPlugin: Box<ISeriesMarkersPluginApi<Time> | null>
  /** Session background — rides the VOLUME series, which survives a chart-type swap. */
  sessionPrim: Box<SessionHighlightPrimitive | null>
  /** Each indicator's live series, parallel to its spec's `series`. */
  indicatorSeries: Map<string, ISeriesApi<'Line' | 'Histogram'>[]>
  /** Band/cloud fills, one per indicator that declares a `fill`. */
  fillPrims: Map<string, BandFillPrimitive>
  /** Which indicator owns each pane index — rebuilt with the series. */
  paneOwners: Map<number, string>
  /** The latest computed indicator values (the legend's fallback, the agent's read-back). */
  latestValues: Box<IndicatorValues>
  /** The last payload pushed to the series — what the next update is diffed against. */
  renderedCandles: Box<Candle[]>
  /** The `time` of the first bar the series was last given — a prepend's anchor. */
  firstBarTime: Box<number | null>
  volumeColors: Box<VolumeColors>
  // Mirrors of render-time values, read by once-subscribed handlers.
  candles: Box<Candle[]>
  props: Box<ChartRuntimeProps>
  chartType: Box<ChartType>
  drawings: Box<ChartDrawing[]>
  activeSpecs: Box<IndicatorSpec[]>
  /** Patch this canvas's live state into the snapshot store (nowhere without a key + chat). */
  publish: (partial: Partial<ChartTabState>) => void
  /**
   * Store into one of the boxes. The runtime is a deliberately mutable, imperative object shared by
   * every chart hook; writing through this method (rather than a property store at each call
   * site) keeps that mutation inside the runtime, where React is not asked to track it.
   */
  /** Ref callback for the canvas host element. */
  setContainer: (element: HTMLDivElement | null) => void
  write: <K extends BoxName>(name: K, value: BoxValue<K>) => void
}

type BoxName = {
  [K in keyof ChartRuntime]: ChartRuntime[K] extends Box<unknown> ? K : never
}[keyof ChartRuntime]
type BoxValue<K extends BoxName> = ChartRuntime[K] extends Box<infer T> ? T : never

const box = <T>(current: T): Box<T> => ({ current })

function createRuntime(props: ChartRuntimeProps): ChartRuntime {
  const runtime: ChartRuntime = {
    container: box(null),
    chart: box(null),
    mainSeries: box(null),
    volumeSeries: box(null),
    drawingLayer: createDrawingLayer(),
    markersPlugin: box(null),
    sessionPrim: box(null),
    indicatorSeries: new Map(),
    fillPrims: new Map(),
    paneOwners: new Map(),
    latestValues: box({}),
    renderedCandles: box([]),
    firstBarTime: box(null),
    volumeColors: box({ up: '#26a69a', down: '#ef5350' }),
    candles: box([]),
    props: box(props),
    chartType: box('candles' as ChartType),
    drawings: box([]),
    activeSpecs: box([]),
    publish: (partial) => {
      const { controlKey, controlSessionId } = runtime.props.current
      if (controlKey && controlSessionId)
        chartStateStore.patch(controlSessionId, controlKey, partial)
    },
    setContainer: (element) => {
      runtime.container.current = element
    },
    write: (name, value) => {
      ;(runtime[name] as Box<unknown>).current = value
    },
  }
  return runtime
}

/** Forget everything that died with the chart instance; a remount recreates it. */
export function releaseChart(rt: ChartRuntime): void {
  rt.markersPlugin.current = null
  rt.sessionPrim.current = null // rode the volume series
  rt.chart.current = null
  rt.mainSeries.current = null
  rt.volumeSeries.current = null
  rt.indicatorSeries.clear()
  rt.renderedCandles.current = []
}

/**
 * One runtime per canvas; the prop mirrors are refreshed on every commit. They are written in a
 * layout effect, not during render, and this hook is the first in `ChartCanvas`, so its mirrors are
 * current before any other hook's effect (layout or passive) reads them.
 */
export function useChartRuntime(candles: Candle[], props: ChartRuntimeProps): ChartRuntime {
  const [runtime] = useState(() => createRuntime(props))
  useLayoutEffect(() => {
    runtime.write('candles', candles)
    runtime.write('props', props)
  })
  return runtime
}
