/**
 * The chart instance's lifecycle and layout: create it once, keep it sized to its box, and measure
 * what the overlays must step around (pane tops, the right axis, the control cluster).
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type Time,
} from 'lightweight-charts'
import { patchIndicatorPref, type IndicatorPrefRecord } from '../model/indicatorPrefs'
import { axisTickLabel, crosshairTimeLabel } from '../model/timeLabels'
import { useVisibleResizeObserver } from '../model/useVisibleResizeObserver'
import { DEFAULT_INDICATOR_PANE_HEIGHT } from './chartIndicatorSeries'
import { SessionHighlightPrimitive } from './sessionHighlightPrimitive'
import { releaseChart, type ChartRuntime } from './useChartRuntime'

export interface ChartLayout {
  /** The chart's own box. Width seeds wide so the control cluster is not needlessly stacked;
   *  HEIGHT seeds 0 so the height-gated chips stay hidden until a measure PROVES the widget tall. */
  chartSize: { w: number; h: number }
  /** Width of the right price axis — the top-right controls are pushed clear of it. */
  rightAxisWidth: number
  /** The control cluster's live width, reserved by the readout column so it wraps first. */
  controlsWidth: number
  controlsRef: React.RefObject<HTMLDivElement | null>
  /** Each pane indicator's top edge, measured from the pane's own element. */
  paneTops: ReadonlyMap<string, number>
  schedulePaneMeasure: () => void
}

/**
 * Persist pane heights after a separator drag. lightweight-charts fires no pane-resize event, so
 * the pointer gesture is observed in capture phase (the separator swallows the bubble). Gated on
 * BOTH the resize cursor and real movement: reading heights after an ordinary click promotes the
 * library's transient auto-layout into explicit prefs and makes panes jump on later clicks.
 */
function observePaneResize(container: HTMLElement, onResized: () => void): () => void {
  let pointer: { id: number; startY: number; moved: boolean } | null = null
  const isPaneSeparator = (target: EventTarget | null) => {
    let element = target instanceof Element ? target : null
    while (element && element !== container) {
      const cursor = getComputedStyle(element).cursor
      if (cursor === 'ns-resize' || cursor === 'row-resize') return true
      element = element.parentElement
    }
    return false
  }
  const begin = (event: PointerEvent) => {
    pointer = isPaneSeparator(event.target)
      ? { id: event.pointerId, startY: event.clientY, moved: false }
      : null
  }
  const track = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return
    if (Math.abs(event.clientY - pointer.startY) > 2) pointer.moved = true
  }
  const end = (event: PointerEvent) => {
    const gesture = pointer
    pointer = null
    if (gesture && gesture.id === event.pointerId && gesture.moved) onResized()
  }
  const cancel = () => {
    pointer = null
  }
  container.addEventListener('pointerdown', begin, true)
  container.addEventListener('pointermove', track, true)
  container.addEventListener('pointerup', end, true)
  container.addEventListener('pointercancel', cancel, true)
  return () => {
    container.removeEventListener('pointerdown', begin, true)
    container.removeEventListener('pointermove', track, true)
    container.removeEventListener('pointerup', end, true)
    container.removeEventListener('pointercancel', cancel, true)
  }
}

export function useChartInstance(
  rt: ChartRuntime,
  sessionHighlight: boolean,
  setIndicatorItems: Dispatch<SetStateAction<IndicatorPrefRecord[]>>,
): ChartLayout {
  const [paneTops, setPaneTops] = useState<ReadonlyMap<string, number>>(new Map())
  const [rightAxisWidth, setRightAxisWidth] = useState(0)
  const [controlsWidth, setControlsWidth] = useState(0)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [chartSize, setChartSize] = useState({ w: 800, h: 0 })
  const sessionHighlightRef = useRef(sessionHighlight)
  sessionHighlightRef.current = sessionHighlight
  const paneMeasureRaf = useRef(0)
  const schedulePaneMeasure = () => {
    cancelAnimationFrame(paneMeasureRaf.current)
    paneMeasureRaf.current = requestAnimationFrame(() => {
      const chart = rt.chart.current
      const container = rt.container.current
      if (!chart || !container) return
      const axisWidth = chart.priceScale('right').width()
      setRightAxisWidth((prev) => (prev === axisWidth ? prev : axisWidth))
      const containerTop = container.getBoundingClientRect().top
      const next = new Map<string, number>()
      for (const [paneIndex, id] of rt.paneOwners) {
        const el = chart.panes()[paneIndex]?.getHTMLElement()
        if (el) next.set(id, el.getBoundingClientRect().top - containerTop)
      }
      setPaneTops((prev) => {
        if (prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v)) return prev
        return next
      })
    })
  }

  useVisibleResizeObserver(controlsRef, (element) => {
    setControlsWidth((prev) => (prev === element.offsetWidth ? prev : element.offsetWidth))
  })

  // Create the chart once. The main (price) series is mounted by the chart-type hook — it owns
  // the swap; the volume series and the session background live for the chart's whole life.
  useEffect(() => {
    const container = rt.container.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      // Times read in the VIEWER's zone (lightweight-charts would render a UTCTimestamp as UTC).
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, tickMarkType: number) =>
          axisTickLabel(time as number, tickMarkType),
      },
      localization: { timeFormatter: (time: Time) => crosshairTimeLabel(time as number) },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.25 } },
      // Snap to the hovered bar's nearest OHLC value so the legend and axis label agree.
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      // Every pan/zoom gesture on (the defaults), stated so the intent is visible.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      // Indicator-pane separators are DRAGGABLE; colors follow the theme hook.
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#888',
        panes: { enableResize: true },
      },
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    const sessionPrim = new SessionHighlightPrimitive()
    sessionPrim.setEnabled(sessionHighlightRef.current)
    sessionPrim.setTimes(rt.candles.current.map((c) => c.time))
    volumeSeries.attachPrimitive(sessionPrim)
    rt.write('sessionPrim', sessionPrim)

    rt.write('chart', chart)
    rt.write('volumeSeries', volumeSeries)

    // Seed the size SYNCHRONOUSLY from the box createChart was handed: the observer's first
    // callback can lag or arrive at 0 height in a static embed, leaving the overlays wrong.
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      setChartSize({ w: container.clientWidth, h: container.clientHeight })
    }

    const stopPaneResize = observePaneResize(container, () => {
      const panes = rt.chart.current?.panes()
      if (!panes) return
      setIndicatorItems((prev) => {
        let next: IndicatorPrefRecord[] = prev
        for (const [paneIndex, id] of rt.paneOwners) {
          const height = panes[paneIndex]?.getHeight()
          if (!height) continue
          const stored = prev.find((r) => r.id === id)?.paneHeight ?? DEFAULT_INDICATOR_PANE_HEIGHT
          if (Math.abs(stored - height) > 1)
            next = patchIndicatorPref(next, id, { paneHeight: height })
        }
        return next
      })
      schedulePaneMeasure()
    })

    return () => {
      cancelAnimationFrame(paneMeasureRaf.current)
      stopPaneResize()
      rt.drawingLayer.detach()
      chart.remove()
      releaseChart(rt)
    }
    // Created once; everything it reads later goes through the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the instance (and its viewport) warm while parked, releasing only the box observer. The
  // hook measures immediately on resume — a chart first created under display:none is 0×0.
  useVisibleResizeObserver(rt.container, (container) => {
    const chart = rt.chart.current
    if (!chart || container.clientWidth <= 0 || container.clientHeight <= 0) return
    chart.resize(container.clientWidth, container.clientHeight)
    setChartSize((prev) =>
      prev.w === container.clientWidth && prev.h === container.clientHeight
        ? prev
        : { w: container.clientWidth, h: container.clientHeight },
    )
    schedulePaneMeasure()
  })

  return { chartSize, rightAxisWidth, controlsWidth, controlsRef, paneTops, schedulePaneMeasure }
}
