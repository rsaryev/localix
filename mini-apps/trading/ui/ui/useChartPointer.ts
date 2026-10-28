/**
 * Pointer interaction: the crosshair OHLCV/indicator readout, hover + selection of indicators and
 * drawings, the measure tool, and the viewport handler (live-edge pill, backfill, snapshot range).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  CandlestickData,
  HistogramData,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
} from 'lightweight-charts'
import { shouldBackfill } from '../model/backfill'
import {
  buildCrosshairLegend,
  isAwayFromRealtime,
  type CrosshairLegend,
} from '../model/crosshairLegend'
import type { MeasurePoint } from './ChartCanvasOverlays'
import type { ChartRuntime, IndicatorValues } from './useChartRuntime'

type Point = { x: number; y: number }
type Measure = { a: MeasurePoint | null; b: MeasurePoint | null }

/** The interaction state; the refs mirror what once-subscribed handlers must read synchronously. */
export function useChartInteraction() {
  const [legend, setLegend] = useState<CrosshairLegend | null>(null)
  const [away, setAway] = useState(false)
  // Pointer parked over a bar: the legend quotes THAT bar and the bar-close countdown hides.
  const [hovering, setHovering] = useState(false)
  const [crosshairValues, setCrosshairValues] = useState<IndicatorValues | null>(null)
  const [hoveredIndicatorId, setHoveredIndicatorId] = useState<string | null>(null)
  const [hoveredDrawingId, setHoveredDrawingId] = useState<string | null>(null)
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string | null>(null)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [selectedDrawingPoint, setSelectedDrawingPoint] = useState<Point | null>(null)
  // Measure tool: two clicks reading the price move, % and bar span between two points.
  const [measuring, setMeasuring] = useState(false)
  const [measure, setMeasure] = useState<Measure>({ a: null, b: null })
  const hoveringRef = useRef(false)
  const hoveredIndicatorIdRef = useRef<string | null>(null)
  const selectedDrawingIdRef = useRef(selectedDrawingId)
  const measuringRef = useRef(measuring)
  const measureRef = useRef(measure)
  // Mirrors for handlers subscribed once to the chart; written at commit, never while rendering.
  useLayoutEffect(() => {
    selectedDrawingIdRef.current = selectedDrawingId
    measuringRef.current = measuring
    measureRef.current = measure
  }, [selectedDrawingId, measuring, measure])
  return {
    legend,
    setLegend,
    away,
    setAway,
    hovering,
    setHovering,
    crosshairValues,
    setCrosshairValues,
    setHoveredIndicatorId,
    setHoveredDrawingId,
    selectedIndicatorId,
    setSelectedIndicatorId,
    selectedDrawingId,
    setSelectedDrawingId,
    selectedDrawingPoint,
    setSelectedDrawingPoint,
    measuring,
    setMeasuring,
    measure,
    setMeasure,
    hoveringRef,
    hoveredIndicatorIdRef,
    selectedDrawingIdRef,
    measuringRef,
    measureRef,
    activeIndicatorId: hoveredIndicatorId ?? selectedIndicatorId,
    activeDrawingId: hoveredDrawingId ?? selectedDrawingId,
  }
}

export type ChartInteraction = ReturnType<typeof useChartInteraction>

/** The drawing (or series marker) a chart event points at. */
function drawingIdOf(param: MouseEventParams<Time>): string | null {
  const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId
  if (typeof objectId === 'string' && objectId.startsWith('drawing:'))
    return objectId.slice('drawing:'.length)
  return param.hoveredInfo?.objectKind === 'series-marker' && typeof objectId === 'string'
    ? objectId
    : null
}

/** Subscribed once; the handlers read the latest series/candles through the runtime. */
export function useChartPointer(rt: ChartRuntime, ix: ChartInteraction): void {
  useEffect(() => {
    const chart = rt.chart.current
    if (!chart) return
    const indicatorAt = (param: MouseEventParams<Time>) =>
      rt.activeSpecs.current.find((spec) =>
        rt.indicatorSeries
          .get(spec.id)
          ?.includes(
            (param.hoveredInfo?.series ?? param.hoveredSeries) as ISeriesApi<'Line' | 'Histogram'>,
          ),
      )
    /** Where the selected hline's remove action sits: just inside the price axis, at its level. */
    const hlineActionPoint = (price: number): Point | null => {
      const y = rt.mainSeries.current?.priceToCoordinate(price)
      if (y === null || y === undefined) return null
      const width = rt.container.current?.clientWidth ?? 0
      const axisWidth = rt.chart.current?.priceScale('right').width() ?? 0
      return { x: width - axisWidth - 8, y }
    }

    const onMove = (param: MouseEventParams<Time>) => {
      const cs = rt.mainSeries.current
      const vs = rt.volumeSeries.current
      const pointData = cs
        ? (param.seriesData.get(cs) as CandlestickData<Time> | LineData<Time> | undefined)
        : undefined
      // A line/area main series reports only {time, value} — recover the full OHLC bar.
      const barData =
        pointData && 'open' in pointData
          ? pointData
          : pointData
            ? rt.candles.current.find((c) => c.time === (pointData.time as number))
            : undefined
      if (barData && 'open' in barData) {
        ix.hoveringRef.current = true
        ix.setHovering(true)
        const volData = vs
          ? (param.seriesData.get(vs) as HistogramData<Time> | undefined)
          : undefined
        ix.setLegend(buildCrosshairLegend(barData, volData?.value ?? null))
        // Each indicator's plots AT the hovered bar, read through the series this canvas owns.
        const hovered: IndicatorValues = {}
        for (const spec of rt.activeSpecs.current) {
          const owned = rt.indicatorSeries.get(spec.id)
          if (!owned) continue
          const plots: Record<string, number> = {}
          spec.series.forEach((s, i) => {
            const series = owned[i]
            const point = series
              ? (param.seriesData.get(series) as LineData<Time> | HistogramData<Time> | undefined)
              : undefined
            if (point && typeof point.value === 'number') plots[s.key] = point.value
          })
          hovered[spec.id] = plots
        }
        ix.setCrosshairValues(hovered)
      } else {
        // Pointer left the chart — fall back to the newest bar rather than blanking the legend.
        ix.hoveringRef.current = false
        ix.setHovering(false)
        const last = rt.candles.current.at(-1)
        ix.setLegend(last ? buildCrosshairLegend(last, last.volume) : null)
        ix.setCrosshairValues(null)
      }
      const hoveredSpec = indicatorAt(param)
      ix.hoveredIndicatorIdRef.current = hoveredSpec?.id ?? null
      ix.setHoveredIndicatorId(hoveredSpec?.id ?? null)
      ix.setHoveredDrawingId(drawingIdOf(param))
    }

    const ts = chart.timeScale()
    // Compare against the chart's ACTUAL realtime offset: the live edge sits at
    // `scrollPosition() === options().rightOffset`.
    const onRange = () => {
      ix.setAway(isAwayFromRealtime(ts.scrollPosition(), ts.options().rightOffset))
      // Keep the measure markers pinned to their {price, logical} as the viewport moves.
      if (ix.measuringRef.current && (ix.measureRef.current.a || ix.measureRef.current.b)) {
        const series = rt.mainSeries.current
        const reproject = (p: MeasurePoint | null): MeasurePoint | null => {
          if (!p || !series) return p
          const x = ts.logicalToCoordinate(p.logical as never)
          const y = series.priceToCoordinate(p.price)
          return x !== null && y !== null ? { ...p, x, y } : p
        }
        ix.setMeasure((prev) => ({ a: reproject(prev.a), b: reproject(prev.b) }))
      }
      const selected = rt.drawings.current.find(
        (item) => item.id === ix.selectedDrawingIdRef.current,
      )
      if (selected?.kind === 'hline') {
        const point = hlineActionPoint(selected.price)
        if (point) ix.setSelectedDrawingPoint(point)
      }
      // Mirror the viewport (unix seconds) into the snapshot store.
      const visible = ts.getVisibleRange()
      if (visible) {
        rt.publish({ visibleRange: { from: visible.from as number, to: visible.to as number } })
      }
      const range = ts.getVisibleLogicalRange()
      if (!range || !shouldBackfill(range.from)) return
      // Just ask: the viewport is shifted where the bars reach the series (the data feed), since
      // a range set now would be clamped against the bars the chart still holds.
      rt.props.current.onLoadOlder?.()
    }

    const onClick = (param: MouseEventParams<Time>) => {
      // Measure mode owns the click: point A, then B, then a fresh A.
      if (ix.measuringRef.current) {
        const series = rt.mainSeries.current
        const price = param.point && series ? series.coordinateToPrice(param.point.y) : null
        if (price != null && param.point && param.logical != null) {
          const pt: MeasurePoint = {
            price,
            logical: param.logical as number,
            x: param.point.x,
            y: param.point.y,
          }
          ix.setMeasure((prev) => (!prev.a || prev.b ? { a: pt, b: null } : { a: prev.a, b: pt }))
        }
        return
      }
      // Some builds report the series on crosshairMove but omit it from the following click
      // frame; the synchronously-updated ref keeps a real line hit from reading as background.
      const indicator =
        indicatorAt(param) ??
        rt.activeSpecs.current.find((spec) => spec.id === ix.hoveredIndicatorIdRef.current)
      const drawingId = drawingIdOf(param)
      if (indicator) {
        // Selecting highlights its legend row (and plot); the row's gear opens the settings.
        ix.setSelectedIndicatorId((current) => (current === indicator.id ? null : indicator.id))
        ix.setSelectedDrawingId(null)
        ix.setSelectedDrawingPoint(null)
      } else if (drawingId) {
        ix.setSelectedDrawingId((current) => {
          const next = current === drawingId ? null : drawingId
          const drawing = rt.drawings.current.find((item) => item.id === drawingId)
          if (next && drawing?.kind === 'hline') {
            ix.setSelectedDrawingPoint(hlineActionPoint(drawing.price) ?? param.point ?? null)
          } else {
            ix.setSelectedDrawingPoint(next && param.point ? param.point : null)
          }
          return next
        })
        ix.setSelectedIndicatorId(null)
      } else {
        ix.setSelectedIndicatorId(null)
        ix.setSelectedDrawingId(null)
        ix.setSelectedDrawingPoint(null)
      }
    }

    chart.subscribeCrosshairMove(onMove)
    chart.subscribeClick(onClick)
    ts.subscribeVisibleLogicalRangeChange(onRange)
    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.unsubscribeClick(onClick)
      ts.unsubscribeVisibleLogicalRangeChange(onRange)
    }
    // Subscribed once; setters are stable and everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
