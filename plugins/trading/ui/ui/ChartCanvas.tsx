/**
 * The chart itself: one lightweight-charts instance, and everything that keeps it in step with
 * React.
 *
 * WHY IT IS ONE FILE, measured rather than assumed. Fourteen refs and fifteen effects, and they
 * are not fifteen independent concerns — they all mutate ONE imperative object that React does not
 * own. The chart holds its own series, scales and visible range; every effect here reaches into
 * that object, and the refs exist precisely because the next effect must see what the last one
 * did WITHOUT a re-render. Split into hooks, those refs become the hooks' shared argument list,
 * and the ordering between them — series created before data, data before range, range before the
 * scroll handler that reports it — stops being visible in the file that depends on it.
 *
 * So the size here is a property of the boundary between a React tree and an imperative canvas,
 * not of the code's organisation. Making it smaller honestly means giving the chart instance an
 * owner outside React (a small controller class the component drives), which is a redesign with a
 * behaviour surface — pan, zoom, live candle push, indicator attach/detach — that nothing in this
 * repository currently tests. Not a move; do it deliberately or not at all.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { canvasColorResolver, normalizeColor } from '../model/cssColor'
import { classifyCandleUpdate, toVolumeData, type VolumeColors } from '../model/candleSeries'
import { resolveIndicators } from '../model/indicatorSpecs'
import {
  activeIds,
  applyIndicatorCommandV2,
  loadIndicatorPrefsV2,
  patchIndicatorPref,
  rekeyIndicatorPref,
  saveIndicatorPrefsV2,
  toggleIndicatorV2,
  type ChartScaleMode,
  type IndicatorPrefRecord,
} from '../model/indicatorPrefs'
import { IndicatorLegend, type IndicatorLegendEntry } from './IndicatorLegend'
import {
  addMainSeries,
  loadChartType,
  mainSeriesData,
  mainSeriesOptions,
  mainSeriesPoint,
  reduceChartType,
  saveChartType,
  type ChartType,
  type MainSeriesApi,
} from '../model/chartType'
import { chartControlBus, type ChartControlCommand } from '../model/chartControlBus'
import type { BandFillPrimitive } from './bandFillPrimitive'
import { SessionHighlightPrimitive } from './sessionHighlightPrimitive'
import type { AnalysisMarket } from './ChartAnalysisMenu'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import type { ChartDrawing } from '../../backend/chart-drawing'
import {
  applyDrawCommand,
  isDetectDrawingId,
  loadDrawings,
  saveDrawings,
  seriesMarkersOf,
} from '../model/chartDrawings'
import { chartStateStore, type ChartTabState } from '../model/chartStateStore'
import { createDrawingLayer } from './drawingLayer'
import { rangeAroundTime, zoomedRange } from '../model/chartNav'
import type { ChartPriceFormat } from '../model/formatQuote'
import {
  buildCrosshairLegend,
  isAwayFromRealtime,
  type CrosshairLegend,
} from '../model/crosshairLegend'
import { prependedBars, shiftedRange, shouldBackfill } from '../model/backfill'
import { axisTickLabel, crosshairTimeLabel } from '../model/timeLabels'
import { ChartCanvasControls } from './ChartCanvasControls'
import {
  ChartLoadingOverlay,
  CrosshairReadout,
  LiveButton,
  MeasureOverlay,
  SelectedDrawingAction,
  type MeasurePoint,
} from './ChartCanvasOverlays'
import {
  DEFAULT_INDICATOR_PANE_HEIGHT,
  feedIndicator,
  rebuildIndicatorSeries,
  styleIndicatorSeries,
} from './chartIndicatorSeries'
import { useVisibleResizeObserver } from '../model/useVisibleResizeObserver'

/** Global preference: shade the trading sessions (Asia/London/NY) as a chart background. */
const SESSION_HIGHLIGHT_KEY = 'localix.trading.sessionHighlight'

/** Chart colors sourced from the app's CSS custom properties (theme-aware). */
interface ChartColors {
  background: string
  text: string
  grid: string
  border: string
  up: string
  down: string
}

/**
 * A theme token, in a syntax the chart can parse. Our tokens are `oklch()`; lightweight-charts'
 * own parser handles only hex / rgb / hsl / named colours and THROWS on anything else, taking the
 * chart down from inside the price-axis renderer. `normalizeColor` asks the browser instead.
 */
function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return normalizeColor(v, fallback, canvasColorResolver)
}

/** Read the chart palette from theme CSS vars (re-read whenever the theme flips). */
function readChartColors(): ChartColors {
  return {
    // The chart paints NO ground of its own: its pane already painted `--background`, and under
    // the host's glass theme that token carries alpha — a second coat from the chart's canvas
    // compounded into an opaque slab. lightweight-charts accepts a transparent solid background.
    background: 'rgba(0, 0, 0, 0)',
    text: readVar('--text-soft', '#a1a1a1'),
    grid: readVar('--border', '#1f1f1f'),
    border: readVar('--border', '#1f1f1f'),
    up: readVar('--status-success', '#26a69a'),
    down: readVar('--status-error', '#ef5350'),
  }
}

/**
 * One bar's point on the volume histogram. A bar the venue reported NO volume for maps to
 * WHITESPACE — `update()` then clears any stale column at that time instead of freezing it, and a
 * bar that never had one is unaffected. Mirrors `toVolumeData`, which simply skips such bars.
 */
function volumePoint(bar: Candle, colors: VolumeColors): HistogramData | WhitespaceData<Time> {
  const time = bar.time as UTCTimestamp
  if (bar.volume === undefined) return { time }
  return { time, value: bar.volume, color: bar.close >= bar.open ? colors.up : colors.down }
}

/**
 * The lightweight-charts canvas — isolated so its imperative lifecycle stays contained.
 *
 * Memoized: the parent tab re-renders on every ticker push, but this canvas only needs to react
 * when the candles themselves (or theme/format) change.
 */
/** Stable empty overlay — a fresh `[]` each render would defeat the memo and the effect dep. */
const EMPTY_OVERLAY: readonly ChartDrawing[] = []

export const ChartCanvas = memo(function ChartCanvas({
  candles,
  theme,
  priceFormat,
  onLoadOlder,
  loading = false,
  controlKey,
  controlSessionId,
  analysisMarket,
  overlayDrawings,
}: {
  candles: Candle[]
  theme: 'dark' | 'light'
  /** Fetch the page of bars before the oldest one held. Called when the viewport nears the left edge
   *  of the history; the prepend is measured from the series, not from this call. */
  onLoadOlder?: () => void
  /** Axis / crosshair / price-line decimals for THIS market. Without it lightweight-charts
   *  renders every market at its 2-decimal default, flattening any low-priced asset. */
  priceFormat: ChartPriceFormat
  /** True while the initial history request is pending; the canvas remains mounted underneath. */
  loading?: boolean
  /** The chart tab id this canvas answers agent commands under (chartControlBus key). Absent in
   *  contexts with no agent control (nothing subscribes). */
  controlKey?: string
  /** The chat this canvas's chart belongs to. Agent commands and the published live state are
   *  addressed by chat AND `controlKey`, so another chat's chart of the same market never moves
   *  this one; absent, the canvas answers no agent at all. */
  controlSessionId?: string
  /** The market + timeframe behind this canvas — what the AI-analysis wizard hands the agent.
   *  Absent in contexts with no agent (the button simply does not render). */
  analysisMarket?: AnalysisMarket
  /**
   * EPHEMERAL drawings owned by another surface — today the order ticket's entry / target / stop
   * and their risk-reward bands, which must appear on the chart while a trade is being typed.
   *
   * They render through the same layer as the user's own drawings and through nothing else: they
   * are never persisted, never published into the chart-state snapshot the agent reads back, and
   * never enter the drawing LIST (so the list, its ids, and the agent's `manage_chart` view of it
   * are untouched). Clearing them restores the chart exactly as it was.
   */
  overlayDrawings?: readonly ChartDrawing[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // Publish this canvas's live state (chart type / indicators / viewport / last bar)
  // into the snapshot store under the tab's key. Through a ref so the once-subscribed
  // handlers (visible range) read the current key without re-subscribing; a canvas
  // with no agent control (`controlKey` absent) publishes nowhere.
  const controlKeyRef = useRef(controlKey)
  controlKeyRef.current = controlKey
  const controlSessionRef = useRef(controlSessionId)
  controlSessionRef.current = controlSessionId
  const publishChartState = (partial: Partial<ChartTabState>) => {
    const key = controlKeyRef.current
    const session = controlSessionRef.current
    if (key && session) chartStateStore.patch(session, key, partial)
  }
  // The MAIN price series — candles by default, swappable to line/area/bars (`chartType`).
  const mainSeriesRef = useRef<MainSeriesApi | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [chartType, setChartType] = useState<ChartType>(() => loadChartType(controlKey))
  const chartTypeRef = useRef(chartType)
  chartTypeRef.current = chartType
  // Agent drawings (hline / trendline / vline), persisted PER TAB — a drawing marks this market
  // at this level. Chart type and the indicator set are per-tab too (keyed by controlKey), each
  // seeding from a legacy global pref on a tab's first load. The layer owns the chart-side objects;
  // the ref mirrors state for the chart-type swap effect (which must re-attach them).
  const [drawings, setDrawings] = useState<ChartDrawing[]>(() =>
    controlKey ? loadDrawings(controlKey) : [],
  )
  const drawingsRef = useRef(drawings)
  drawingsRef.current = drawings
  const drawingLayerRef = useRef<ReturnType<typeof createDrawingLayer> | null>(null)
  drawingLayerRef.current ??= createDrawingLayer()
  const overlayRef = useRef<readonly ChartDrawing[]>(overlayDrawings ?? EMPTY_OVERLAY)
  overlayRef.current = overlayDrawings ?? EMPTY_OVERLAY
  /** What the chart SHOWS: the persisted list plus whatever overlay is live. Only the list is
   *  ever saved or published — see the `overlayDrawings` prop. */
  const syncDrawingLayer = (list: readonly ChartDrawing[]) =>
    drawingLayerRef.current?.sync(
      overlayRef.current.length === 0 ? list : [...list, ...overlayRef.current],
    )
  // Trade markers (drawing kind 'marker') render through lightweight-charts' NATIVE series-marker
  // plugin on the main series — recreated on a chart-type swap (the swap removed the series the
  // plugin was attached to), re-fed by the drawings effect.
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  // The indicator PREF RECORDS (persisted, v2): presence = active, each carrying its overrides
  // (hidden / color / fixed range / pane height), plus the main scale's mode. All off by default
  // (an always-on indicator the user cannot remove is clutter). The live series each indicator
  // owns — one array per id, parallel to its spec's `series` — live in a ref beside them.
  const indicatorSeriesRef = useRef(new Map<string, ISeriesApi<'Line' | 'Histogram'>[]>())
  // Band/cloud fills (Bollinger, Keltner, Donchian, Ichimoku) — one primitive per indicator that
  // declares a `fill`, attached to its first series and rebuilt with it.
  const fillPrimsRef = useRef(new Map<string, BandFillPrimitive>())
  const [indicatorItems, setIndicatorItems] = useState<IndicatorPrefRecord[]>(
    () => loadIndicatorPrefsV2(controlKey).items,
  )
  const [scaleMode, setScaleMode] = useState<ChartScaleMode>(
    () => loadIndicatorPrefsV2(controlKey).scaleMode ?? 'linear',
  )
  const activeIndicators = useMemo(() => activeIds(indicatorItems), [indicatorItems])
  const overrides = useMemo(() => new Map(indicatorItems.map((r) => [r.id, r])), [indicatorItems])
  // The RESOLVED drawable specs for the active ids (parameterized — `ema:200` works as well as
  // the menu presets), in deterministic overlay-then-pane order. The refs mirror what the
  // streaming data-push effect and the pane-height persist read without re-subscribing.
  const activeSpecs = useMemo(() => resolveIndicators(activeIndicators), [activeIndicators])
  const activeSpecsRef = useRef(activeSpecs)
  activeSpecsRef.current = activeSpecs
  // Which indicator owns each pane index — rebuilt with the series; the separator-drag persist
  // and the pane legend both key off it.
  const paneOwnersRef = useRef(new Map<number, string>())
  // Legend inputs: each PANE row is pinned to its pane's top edge (measured from the pane's own
  // element — heights, separators and layout all included for free); values follow the crosshair
  // while hovering, else the latest computed values from the feed path.
  const [paneTops, setPaneTops] = useState<ReadonlyMap<string, number>>(new Map())
  const [crosshairValues, setCrosshairValues] = useState<Record<
    string,
    Record<string, number>
  > | null>(null)
  const latestValuesRef = useRef<Record<string, Record<string, number>>>({})
  // Width of the right price axis, measured from the chart. The top-right chart controls are
  // pushed clear of it: the axis is as wide as the market's price string, so a fixed inset that
  // clears BTC's 5 digits sits on top of a 9-digit one. Measured in the same pass as the pane
  // tops — the axis can only change width when the layout or the data behind it does.
  const [rightAxisWidth, setRightAxisWidth] = useState(0)
  // The top-right control cluster's live width. The OHLCV/indicator readout column reserves it so
  // its text wraps BEFORE the buttons instead of sliding under them — a guessed reserve (a fixed
  // rem) was blind to how many controls the cluster carries and let a wide toolbar overlap it.
  const [controlsWidth, setControlsWidth] = useState(0)
  const controlsRef = useRef<HTMLDivElement>(null)
  // The chart's own box, tracked so overlays can step out of the way in a small embedded widget
  // (a short chart's top readout and bottom chips would otherwise collide). Width seeds wide so
  // the control cluster is not needlessly stacked before the first measure; HEIGHT seeds 0 so the
  // height-gated bottom chips stay hidden until a measure PROVES the widget is tall — a short
  // embed must never flash them over the readout, and a stuck measure must fail safe (hidden).
  const [chartSize, setChartSize] = useState({ w: 800, h: 0 })
  const paneMeasureRaf = useRef(0)
  const schedulePaneMeasure = () => {
    cancelAnimationFrame(paneMeasureRaf.current)
    paneMeasureRaf.current = requestAnimationFrame(() => {
      const chart = chartRef.current
      const container = containerRef.current
      if (!chart || !container) return
      const axisWidth = chart.priceScale('right').width()
      setRightAxisWidth((prev) => (prev === axisWidth ? prev : axisWidth))
      const containerTop = container.getBoundingClientRect().top
      const next = new Map<string, number>()
      for (const [paneIndex, id] of paneOwnersRef.current) {
        const el = chart.panes()[paneIndex]?.getHTMLElement()
        if (el) next.set(id, el.getBoundingClientRect().top - containerTop)
      }
      setPaneTops((prev) => {
        if (prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v)) return prev
        return next
      })
    })
  }
  // Track the control cluster's width so the readout column can reserve exactly it (below). The
  // cluster grows and shrinks as controls appear (presets, the clear buttons) — a live measure, not
  // a guess, is what keeps the readout from ever landing under it.
  useVisibleResizeObserver(controlsRef, (element) => {
    setControlsWidth((prev) => (prev === element.offsetWidth ? prev : element.offsetWidth))
  })
  // Latest candles + volume colors, read by the theme effect (which recolors the volume
  // bars without waiting for the next data push). Declared before the effects that read them.
  const candlesRef = useRef(candles)
  candlesRef.current = candles
  // Read by the chart-type swap effect (a swap must re-apply the market's decimals without the
  // swap effect re-running on every precision change — the priceFormat effect below owns that).
  const priceFormatRef = useRef(priceFormat)
  priceFormatRef.current = priceFormat
  // The last payload actually pushed to the series — what `classifyCandleUpdate` diffs the next
  // one against. Incremental `update()` covers a live tick AND a bar rollover; full `setData` is
  // reserved for the initial load, prepends and deep corrections. This is the difference between a
  // cheap tick and rebuilding a many-hundred-bar chart on every quote.
  const renderedCandlesRef = useRef<Candle[]>([])
  // The range handler subscribes once; it reads the current loader through a ref rather than
  // re-subscribing whenever the market (and therefore the closure) changes.
  const loadOlderRef = useRef(onLoadOlder)
  loadOlderRef.current = onLoadOlder
  /** The `time` of the first bar the series was last given — the anchor a prepend is measured from. */
  const firstBarTimeRef = useRef<number | null>(null)
  const volumeColorsRef = useRef<VolumeColors>({ up: '#26a69a', down: '#ef5350' })

  // The crosshair OHLCV readout, and whether the user has panned off the live edge. `hoveringRef`
  // guards the fallback: while the pointer is over a bar the legend follows it; otherwise it tracks
  // the newest bar (updated both on leave and as fresh candles stream in).
  const [legend, setLegend] = useState<CrosshairLegend | null>(null)
  const [away, setAway] = useState(false)
  // Whether the pointer is parked over a bar (the legend then quotes THAT bar, so the live
  // bar-close countdown is hidden — a countdown next to a 2-day-old bar reads as a bug).
  const [hovering, setHovering] = useState(false)
  // Session-highlight background toggle (global preference). The primitive rides the VOLUME
  // series — which survives a chart-type swap — so no re-attach is needed.
  const [sessionHighlight, setSessionHighlight] = useState(
    () => loadJSON<boolean>(SESSION_HIGHLIGHT_KEY) === true,
  )
  const sessionPrimRef = useRef<SessionHighlightPrimitive | null>(null)
  const sessionHighlightRef = useRef(sessionHighlight)
  sessionHighlightRef.current = sessionHighlight
  const [hoveredIndicatorId, setHoveredIndicatorId] = useState<string | null>(null)
  const [hoveredDrawingId, setHoveredDrawingId] = useState<string | null>(null)
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string | null>(null)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [selectedDrawingPoint, setSelectedDrawingPoint] = useState<{ x: number; y: number } | null>(
    null,
  )
  const activeIndicatorId = hoveredIndicatorId ?? selectedIndicatorId
  const activeDrawingId = hoveredDrawingId ?? selectedDrawingId
  const hoveredIndicatorIdRef = useRef<string | null>(null)
  const selectedDrawingIdRef = useRef(selectedDrawingId)
  selectedDrawingIdRef.current = selectedDrawingId
  const hoveringRef = useRef(false)
  // Measure tool: a two-click mode reading the price move, % and bar span between two points.
  // The click handler branches on this ref (updated synchronously) before selection logic.
  const [measuring, setMeasuring] = useState(false)
  const [measure, setMeasure] = useState<{ a: MeasurePoint | null; b: MeasurePoint | null }>({
    a: null,
    b: null,
  })
  const measuringRef = useRef(measuring)
  measuringRef.current = measuring
  const measureRef = useRef(measure)
  measureRef.current = measure

  // Create the chart once. The v5 API: `createChart` → `IChartApi`; series are added with
  // `chart.addSeries(CandlestickSeries, opts)` / `addSeries(HistogramSeries, opts)`.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
      // Times read in the VIEWER's zone. lightweight-charts renders a `UTCTimestamp` as UTC, so a
      // bar that opened at 14:00 UTC was labelled `14:00` beside a wall clock saying something else
      // — a trader lining a candle up against a fill or a funding settlement was off by their offset.
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, tickMarkType: number) =>
          axisTickLabel(time as number, tickMarkType),
      },
      localization: { timeFormatter: (time: Time) => crosshairTimeLabel(time as number) },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.25 } },
      // Snap the crosshair's horizontal line to the nearest OHLC value of the hovered bar (not just
      // the close), so the legend and the axis label agree with what the eye is pointing at.
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      // Keep every pan/zoom gesture on (the defaults), stated explicitly so the intent is visible:
      // drag to pan, wheel/pinch to zoom time, drag the price axis to zoom price.
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
      // Indicator-pane separators are DRAGGABLE; the heights land in the
      // per-indicator prefs via the pointerup persist below. Colors follow the theme effect.
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#888',
        panes: { enableResize: true },
      },
    })
    // The main (price) series is mounted by the chartType effect below — it owns the swap.
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    // The session-highlight background rides the volume series (persists across a chart-type swap).
    const sessionPrim = new SessionHighlightPrimitive()
    sessionPrim.setEnabled(sessionHighlightRef.current)
    sessionPrim.setTimes(candlesRef.current.map((c) => c.time))
    volumeSeries.attachPrimitive(sessionPrim)
    sessionPrimRef.current = sessionPrim

    chartRef.current = chart
    volumeSeriesRef.current = volumeSeries

    // Seed the tracked size SYNCHRONOUSLY from the box createChart was just handed (real, > 0 —
    // it drew the candles). The ResizeObserver's first callback can lag or arrive at 0 height in
    // a static embed, which left chartSize stuck on its placeholder and the height-gated overlays
    // (the bottom chips) wrong — a control chip climbing into the OHLCV line in a short widget.
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      setChartSize({ w: container.clientWidth, h: container.clientHeight })
    }

    const indicatorSeries = indicatorSeriesRef.current

    // Persist pane heights after a separator drag. lightweight-charts fires no pane-resize
    // event, so we observe the pointer gesture in capture phase (the separator swallows the
    // bubble). It is important to gate this on BOTH the resize cursor and real pointer movement:
    // reading the pane heights after every ordinary chart click promotes the library's transient
    // auto-layout into explicit preferences, rebuilds every indicator series and makes panes
    // progressively jump/shrink on subsequent clicks.
    let paneResizePointer: { id: number; startY: number; moved: boolean } | null = null
    const isPaneSeparator = (target: EventTarget | null) => {
      let element = target instanceof Element ? target : null
      while (element && element !== container) {
        const cursor = getComputedStyle(element).cursor
        if (cursor === 'ns-resize' || cursor === 'row-resize') return true
        element = element.parentElement
      }
      return false
    }
    const beginPaneResize = (event: PointerEvent) => {
      paneResizePointer = isPaneSeparator(event.target)
        ? { id: event.pointerId, startY: event.clientY, moved: false }
        : null
    }
    const trackPaneResize = (event: PointerEvent) => {
      if (!paneResizePointer || paneResizePointer.id !== event.pointerId) return
      if (Math.abs(event.clientY - paneResizePointer.startY) > 2) paneResizePointer.moved = true
    }
    const persistPaneHeights = (event: PointerEvent) => {
      const gesture = paneResizePointer
      paneResizePointer = null
      if (!gesture || gesture.id !== event.pointerId || !gesture.moved) return
      const panes = chartRef.current?.panes()
      if (!panes) return
      setIndicatorItems((prev) => {
        let next: IndicatorPrefRecord[] = prev as IndicatorPrefRecord[]
        for (const [paneIndex, id] of paneOwnersRef.current) {
          const height = panes[paneIndex]?.getHeight()
          if (!height) continue
          const stored = prev.find((r) => r.id === id)?.paneHeight ?? DEFAULT_INDICATOR_PANE_HEIGHT
          if (Math.abs(stored - height) > 1) {
            next = patchIndicatorPref(next, id, { paneHeight: height })
          }
        }
        return next
      })
      schedulePaneMeasure()
    }
    const cancelPaneResize = () => {
      paneResizePointer = null
    }
    container.addEventListener('pointerdown', beginPaneResize, true)
    container.addEventListener('pointermove', trackPaneResize, true)
    container.addEventListener('pointerup', persistPaneHeights, true)
    container.addEventListener('pointercancel', cancelPaneResize, true)

    return () => {
      cancelAnimationFrame(paneMeasureRaf.current)
      container.removeEventListener('pointerdown', beginPaneResize, true)
      container.removeEventListener('pointermove', trackPaneResize, true)
      container.removeEventListener('pointerup', persistPaneHeights, true)
      container.removeEventListener('pointercancel', cancelPaneResize, true)
      drawingLayerRef.current?.detach()
      markersPluginRef.current = null // dies with the chart; a remount recreates it
      sessionPrimRef.current = null // rode the volume series, gone with the chart
      chart.remove()
      chartRef.current = null
      mainSeriesRef.current = null
      volumeSeriesRef.current = null
      indicatorSeries.clear()
      renderedCandlesRef.current = []
    }
  }, [])

  // Keep the imperative chart instance (and therefore its viewport/zoom) warm, but release its
  // external box observer while the work item is parked. The hook measures immediately on resume,
  // covering a chart that was first created under display:none with a 0×0 box.
  useVisibleResizeObserver(containerRef, (container) => {
    const chart = chartRef.current
    if (!chart || container.clientWidth <= 0 || container.clientHeight <= 0) return
    chart.resize(container.clientWidth, container.clientHeight)
    setChartSize((prev) =>
      prev.w === container.clientWidth && prev.h === container.clientHeight
        ? prev
        : { w: container.clientWidth, h: container.clientHeight },
    )
    schedulePaneMeasure()
  })

  // Mount (or SWAP) the main price series whenever the chart type changes. A swap is a full
  // remove + add + setData: the four series kinds are different renderers in lightweight-charts,
  // and a type change is a rare, deliberate act — reconciling in place would buy nothing. The
  // viewport (time scale) lives on the chart, so it survives the swap untouched. Persisted here,
  // like the indicator set in its own rebuild effect.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    saveChartType(chartType, controlKeyRef.current)
    if (mainSeriesRef.current) chart.removeSeries(mainSeriesRef.current)
    const series = addMainSeries(chart, chartType, volumeColorsRef.current)
    series.applyOptions({ priceFormat: { type: 'price', ...priceFormatRef.current } })
    series.setData(mainSeriesData(chartType, candlesRef.current) as never[])
    mainSeriesRef.current = series
    // Drawings live ON the main series (price lines + primitives) — the swap that removed the
    // old series took them down, so re-attach them to the new one. Same for the trade-marker
    // plugin: the old instance died with its series; create a fresh one carrying the current set.
    drawingLayerRef.current?.attach(series)
    syncDrawingLayer(drawingsRef.current)
    markersPluginRef.current = createSeriesMarkers(series, seriesMarkersOf(drawingsRef.current))
    publishChartState({ chartType })
    // publishChartState is stable-by-ref (reads controlKeyRef); the swap keys on chartType alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType])

  // Keep the chart's drawing objects, the per-tab persistence and the snapshot store in step
  // with the drawing list. Runs AFTER the chart-type effect on mount, so the main series exists;
  // on a later swap the swap effect itself re-attaches (this effect only keys on the list).
  useEffect(() => {
    const key = controlKeyRef.current
    if (key) saveDrawings(key, drawings)
    syncDrawingLayer(drawings)
    markersPluginRef.current?.setMarkers(seriesMarkersOf(drawings))
    publishChartState({ drawings })
    // publishChartState is stable-by-ref (reads controlKeyRef); keyed on the list alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings])

  // The overlay changes as a trade is typed; nothing is saved or published for it.
  useEffect(() => {
    syncDrawingLayer(drawingsRef.current)
    // `syncDrawingLayer` reads refs; the effect keys on the overlay identity alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayDrawings])

  // Persist the prefs (records + scale mode) whenever either changes — one write, one
  // per-tab key (the write is what promotes the global seed to a per-tab entry).
  useEffect(() => {
    saveIndicatorPrefsV2(
      {
        v: 2,
        items: indicatorItems,
        ...(scaleMode !== 'linear' ? { scaleMode } : {}),
      },
      controlKeyRef.current,
    )
  }, [indicatorItems, scaleMode])

  // The MAIN price scale's mode (linear / log / percentage). Indicator panes keep their own
  // scales — a fixed-range RSI must not go logarithmic because the price did.
  useEffect(() => {
    const modeFor: Record<ChartScaleMode, PriceScaleMode> = {
      linear: PriceScaleMode.Normal,
      log: PriceScaleMode.Logarithmic,
      percentage: PriceScaleMode.Percentage,
    }
    chartRef.current?.priceScale('right').applyOptions({ mode: modeFor[scaleMode] })
    publishChartState({ scaleMode })
    // publishChartState is stable-by-ref (reads controlKeyRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleMode])

  // (Re)build the indicator series whenever the enabled set OR an override changes. A rebuild
  // (teardown + create in catalog order) keeps pane indices dense and deterministic —
  // lightweight-charts removes an empty pane itself, and toggling is rare, so reconciling in
  // place would buy nothing. A HIDDEN indicator keeps its series mounted (`visible: false`):
  // removing them would renumber every pane below, and the eye must not move the furniture.
  // The data-push effect below keeps the created series fed thereafter.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const values = rebuildIndicatorSeries({
      chart,
      specs: activeSpecs,
      overrides,
      candles: candlesRef.current,
      seriesById: indicatorSeriesRef.current,
      fillsById: fillPrimsRef.current,
      paneOwners: paneOwnersRef.current,
    })
    latestValuesRef.current = values
    schedulePaneMeasure()
    // Canonical resolved ids, in the same overlay-then-pane order the chart draws.
    publishChartState({
      indicators: activeSpecs.map((spec) => spec.id),
      hiddenIndicators: activeSpecs.flatMap((spec) =>
        overrides.get(spec.id)?.hidden === true ? [spec.id] : [],
      ),
      indicatorValues: values,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpecs, overrides])

  // A chart line should feel like an object, not paint baked into the canvas. lightweight-charts
  // tells us which series is under the pointer; thicken every line belonging to that indicator
  // while it is hovered, restoring each plot's authored width on leave/removal.
  // …and while ONE indicator is active, the rest recede: their lines drop to ~30% opacity, so the
  // hovered object reads instantly without a tooltip. Widths and colors are restored from the
  // authored spec (+ the user's primary-color override) the moment nothing is active.
  useEffect(() => {
    styleIndicatorSeries({
      specs: activeSpecs,
      activeId: activeIndicatorId,
      overrides,
      seriesById: indicatorSeriesRef.current,
    })
  }, [activeSpecs, activeIndicatorId, overrides])

  useEffect(() => drawingLayerRef.current?.highlight(activeDrawingId), [activeDrawingId])

  // Session-highlight toggle: flip the primitive and persist the preference.
  useEffect(() => {
    sessionPrimRef.current?.setEnabled(sessionHighlight)
    saveJSON(SESSION_HIGHLIGHT_KEY, sessionHighlight ? true : null)
  }, [sessionHighlight])

  // Apply theme colors (re-read from CSS vars on every theme flip — the `theme` dep fires
  // after `data-theme` is stamped on <html>, so `getComputedStyle` sees the new values).
  useEffect(() => {
    const chart = chartRef.current
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
    // Type-appropriate colors: candles/bars take up/down, line/area a fixed accent.
    mainSeriesRef.current?.applyOptions(
      mainSeriesOptions(chartTypeRef.current, { up: colors.up, down: colors.down }),
    )
    // Volume bar colors ride on each data point (up/down), so a theme flip re-sets them wholesale.
    volumeColorsRef.current = { up: colors.up, down: colors.down }
    volumeSeriesRef.current?.setData(toVolumeData(candlesRef.current, volumeColorsRef.current))
  }, [theme])

  // Push data whenever the series change — incrementally where the change shape allows it.
  useEffect(() => {
    const mainSeries = mainSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!mainSeries || !volumeSeries) return

    const change = classifyCandleUpdate(renderedCandlesRef.current, candles)

    // Older bars arriving push every existing bar's logical index up. Move the viewport by the same
    // amount and the chart does not move at all; only the void to its left fills in.
    const added = prependedBars(firstBarTimeRef.current, candles)
    firstBarTimeRef.current = candles[0]?.time ?? null

    const pushBar = (bar: Candle) => {
      // The point is shaped FOR the mounted series type (line/area read the close).
      mainSeries.update(mainSeriesPoint(chartTypeRef.current, bar) as never)
      volumeSeries.update(volumePoint(bar, volumeColorsRef.current))
    }

    switch (change.kind) {
      case 'none':
        break
      case 'tick':
        pushBar(change.bar)
        break
      case 'append':
        // The rollover finalises the closed bar AND opens the next one; `update()` reaches both —
        // replace the (still) last bar with its final numbers, then append the new one.
        if (change.corrected) pushBar(change.corrected)
        pushBar(change.bar)
        break
      case 'reset':
        mainSeries.setData(mainSeriesData(chartTypeRef.current, candles) as never[])
        volumeSeries.setData(toVolumeData(candles, volumeColorsRef.current))
        break
    }
    renderedCandlesRef.current = candles
    // The session background shades by bar time — keep it fed as bars stream/prepend.
    sessionPrimRef.current?.setTimes(candles.map((c) => c.time))
    // Keep the enabled indicators in step with the candles (including streaming ticks).
    // Indicators are opt-in — no O(n) recompute happens while none are on. The latest
    // computed values ride into the snapshot store so the agent reads numbers, not ids.
    if (change.kind !== 'none' && activeSpecsRef.current.length > 0) {
      const values: Record<string, Record<string, number>> = {}
      for (const spec of activeSpecsRef.current) {
        const owned = indicatorSeriesRef.current.get(spec.id)
        if (owned)
          values[spec.id] = feedIndicator(spec, owned, candles, fillPrimsRef.current.get(spec.id))
      }
      latestValuesRef.current = values
      publishChartState({ indicatorValues: values })
    }
    if (added > 0) {
      const ts = chartRef.current?.timeScale()
      const range = ts?.getVisibleLogicalRange()
      if (ts && range) ts.setVisibleLogicalRange(shiftedRange(range, added))
    }
    // Keep the legend's fallback (the newest bar) current as candles stream in — but never while the
    // pointer is parked over an older bar, which the crosshair handler owns.
    if (!hoveringRef.current) {
      const last = candles.at(-1)
      setLegend(last ? buildCrosshairLegend(last, last.volume) : null)
    }
    // The newest bar, for the snapshot read-back (cheap: time + close off the array's tail).
    const newest = candles.at(-1)
    if (newest) publishChartState({ lastCandle: { time: newest.time, close: newest.close } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles])

  // Crosshair readout + "away from the live edge" affordance. Subscribed once; the handlers read the
  // latest series/candles through refs, so nothing here re-subscribes on a data or precision change.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const onMove = (param: MouseEventParams<Time>) => {
      const cs = mainSeriesRef.current
      const vs = volumeSeriesRef.current
      const pointData = cs
        ? (param.seriesData.get(cs) as CandlestickData<Time> | LineData<Time> | undefined)
        : undefined
      // A line/area main series reports only {time, value} — recover the full OHLC bar from the
      // candles themselves so the legend never degrades with the chart type.
      const barData =
        pointData && 'open' in pointData
          ? pointData
          : pointData
            ? candlesRef.current.find((c) => c.time === (pointData.time as number))
            : undefined
      if (barData && 'open' in barData) {
        hoveringRef.current = true
        setHovering(true) // same-value setState bails out — no redundant re-render
        const volData = vs
          ? (param.seriesData.get(vs) as HistogramData<Time> | undefined)
          : undefined
        setLegend(buildCrosshairLegend(barData, volData?.value ?? null))
        // Each indicator's plots AT the hovered bar — the same `seriesData` map, read through
        // the series this canvas owns, so a legend row never guesses which line it is quoting.
        const hovered: Record<string, Record<string, number>> = {}
        for (const spec of activeSpecsRef.current) {
          const owned = indicatorSeriesRef.current.get(spec.id)
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
        setCrosshairValues(hovered)
      } else {
        // Pointer left the chart — fall back to the newest bar rather than blanking the legend.
        hoveringRef.current = false
        setHovering(false)
        const last = candlesRef.current.at(-1)
        setLegend(last ? buildCrosshairLegend(last, last.volume) : null)
        setCrosshairValues(null)
      }

      const hoveredSpec = activeSpecsRef.current.find((spec) =>
        indicatorSeriesRef.current
          .get(spec.id)
          ?.includes(
            (param.hoveredInfo?.series ?? param.hoveredSeries) as ISeriesApi<'Line' | 'Histogram'>,
          ),
      )
      hoveredIndicatorIdRef.current = hoveredSpec?.id ?? null
      setHoveredIndicatorId(hoveredSpec?.id ?? null)
      const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId
      setHoveredDrawingId(
        typeof objectId === 'string' && objectId.startsWith('drawing:')
          ? objectId.slice('drawing:'.length)
          : param.hoveredInfo?.objectKind === 'series-marker' && typeof objectId === 'string'
            ? objectId
            : null,
      )
    }
    const ts = chart.timeScale()
    // Compare against the chart's ACTUAL realtime offset, not the parameter default: the live edge
    // sits at `scrollPosition() === options().rightOffset`. Passing a rightOffset (breathing room for
    // the live candle) would otherwise leave the pill's baseline at 0 and it would never re-appear.
    const onRange = () => {
      setAway(isAwayFromRealtime(ts.scrollPosition(), ts.options().rightOffset))
      // Keep the measure markers pinned to their price/bar as the viewport moves — the points'
      // source of truth is {price, logical}; their screen x/y are recomputed each frame.
      if (measuringRef.current && (measureRef.current.a || measureRef.current.b)) {
        const series = mainSeriesRef.current
        const reproject = (p: MeasurePoint | null): MeasurePoint | null => {
          if (!p || !series) return p
          const x = ts.logicalToCoordinate(p.logical as never)
          const y = series.priceToCoordinate(p.price)
          return x !== null && y !== null ? { ...p, x, y } : p
        }
        setMeasure((prev) => ({ a: reproject(prev.a), b: reproject(prev.b) }))
      }
      const selected = drawingsRef.current.find((item) => item.id === selectedDrawingIdRef.current)
      if (selected?.kind === 'hline') {
        const y = mainSeriesRef.current?.priceToCoordinate(selected.price)
        if (y !== null && y !== undefined) {
          const width = containerRef.current?.clientWidth ?? 0
          const axisWidth = chartRef.current?.priceScale('right').width() ?? 0
          setSelectedDrawingPoint({ x: width - axisWidth - 8, y })
        }
      }
      // Mirror the viewport into the snapshot store (a plain Map write per gesture
      // frame). `getVisibleRange` is time-based (unix seconds) — what the agent asks.
      const visible = ts.getVisibleRange()
      if (visible) {
        publishChartState({
          visibleRange: { from: visible.from as number, to: visible.to as number },
        })
      }
      const range = ts.getVisibleLogicalRange()
      if (!range || !shouldBackfill(range.from)) return
      // Just ask. The viewport is shifted where the bars actually reach the series (the data effect
      // below) — not here: this promise resolves before React re-renders, so a range set now would be
      // clamped against the bars the chart still holds, and the clamp would outlive the redraw.
      loadOlderRef.current?.()
    }
    chart.subscribeCrosshairMove(onMove)
    const onClick = (param: MouseEventParams<Time>) => {
      // Measure mode owns the click: point A, then point B, then a fresh A. Runs before the
      // selection logic so a measure click never toggles an indicator/drawing.
      if (measuringRef.current) {
        const price =
          param.point && mainSeriesRef.current
            ? mainSeriesRef.current.coordinateToPrice(param.point.y)
            : null
        if (price != null && param.point && param.logical != null) {
          const pt: MeasurePoint = {
            price,
            logical: param.logical as number,
            x: param.point.x,
            y: param.point.y,
          }
          setMeasure((prev) => (!prev.a || prev.b ? { a: pt, b: null } : { a: prev.a, b: pt }))
        }
        return
      }
      const indicatorFromEvent = activeSpecsRef.current.find((spec) =>
        indicatorSeriesRef.current
          .get(spec.id)
          ?.includes(
            (param.hoveredInfo?.series ?? param.hoveredSeries) as ISeriesApi<'Line' | 'Histogram'>,
          ),
      )
      // Some lightweight-charts builds report the series during crosshairMove but omit it from
      // the immediately following click frame. The ref is updated synchronously by onMove, unlike
      // React state, so a real line hit cannot be mistaken for a background click.
      const indicator =
        indicatorFromEvent ??
        activeSpecsRef.current.find((spec) => spec.id === hoveredIndicatorIdRef.current)
      const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId
      const drawingId =
        typeof objectId === 'string' && objectId.startsWith('drawing:')
          ? objectId.slice('drawing:'.length)
          : param.hoveredInfo?.objectKind === 'series-marker' && typeof objectId === 'string'
            ? objectId
            : null

      if (indicator) {
        // Selecting an indicator only highlights its legend row (and its plot); the row's gear opens
        // the settings popover. No floating popover is spawned at the click point any more.
        setSelectedIndicatorId((current) => (current === indicator.id ? null : indicator.id))
        setSelectedDrawingId(null)
        setSelectedDrawingPoint(null)
      } else if (drawingId) {
        setSelectedDrawingId((current) => {
          const next = current === drawingId ? null : drawingId
          const drawing = drawingsRef.current.find((item) => item.id === drawingId)
          if (next && drawing?.kind === 'hline') {
            const y = mainSeriesRef.current?.priceToCoordinate(drawing.price)
            const width = containerRef.current?.clientWidth ?? 0
            const axisWidth = chartRef.current?.priceScale('right').width() ?? 0
            setSelectedDrawingPoint(
              y === null || y === undefined
                ? (param.point ?? null)
                : { x: width - axisWidth - 8, y },
            )
          } else {
            setSelectedDrawingPoint(next && param.point ? param.point : null)
          }
          return next
        })
        setSelectedIndicatorId(null)
      } else {
        setSelectedIndicatorId(null)
        setSelectedDrawingId(null)
        setSelectedDrawingPoint(null)
      }
    }
    chart.subscribeClick(onClick)
    ts.subscribeVisibleLogicalRangeChange(onRange)
    return () => {
      chart.unsubscribeCrosshairMove(onMove)
      chart.unsubscribeClick(onClick)
      ts.unsubscribeVisibleLogicalRangeChange(onRange)
    }
  }, [])

  // The market's decimals arrive after the chart is built (the market list loads async), and
  // change with the symbol. Applied to the SERIES rather than at creation so a precision change
  // never tears down and rebuilds the chart.
  useEffect(() => {
    mainSeriesRef.current?.applyOptions({ priceFormat: { type: 'price', ...priceFormat } })
  }, [priceFormat])

  // Agent commands (manage_chart → chartControlBus, keyed by this chat and chart tab). The canvas
  // owns indicators, chart type and the viewport; the timeframe command is the TAB's (it owns that
  // state) — both subscribe under the same key and each handles its own concern.
  useEffect(() => {
    if (!controlKey || !controlSessionId) return
    return chartControlBus.subscribe(
      controlSessionId,
      controlKey,
      (command: ChartControlCommand) => {
        if (command.type === 'set_indicators') {
          setIndicatorItems((prev) => applyIndicatorCommandV2(prev, command.mode, command.ids))
          return
        }
        if (command.type === 'configure_indicator') {
          setIndicatorItems((prev) => patchIndicatorPref(prev, command.id, command.patch))
          return
        }
        if (command.type === 'set_scale_mode') {
          setScaleMode(command.mode)
          return
        }
        if (command.type === 'set_chart_type') {
          setChartType((prev) => reduceChartType(prev, command.chartType))
          return
        }
        if (command.type === 'draw') {
          setDrawings((prev) => applyDrawCommand(prev, command.mode, command.drawing, command.id))
          return
        }
        if (command.type !== 'navigate') return
        const chart = chartRef.current
        if (!chart) return
        const ts = chart.timeScale()
        if (command.op === 'to_realtime') return ts.scrollToRealTime()
        if (command.op === 'fit') return ts.fitContent()
        const range = ts.getVisibleLogicalRange()
        if (command.op === 'zoom_in' || command.op === 'zoom_out') {
          if (range)
            ts.setVisibleLogicalRange(zoomedRange(range, command.op === 'zoom_in' ? 0.5 : 2))
          return
        }
        if (command.op === 'to_time') {
          // Center the nearest LOADED bar, keeping the current span.
          const span = range ? range.to - range.from : 120
          const next = rangeAroundTime(candlesRef.current, command.time, span)
          if (next) ts.setVisibleLogicalRange(next)
        }
      },
    )
  }, [controlKey, controlSessionId])

  const decimals = priceFormat.precision
  // One row per active indicator: values follow the crosshair while hovering, else the latest
  // computed ones the feed path already produced (no second compute for the legend).
  const legendEntries: IndicatorLegendEntry[] = activeSpecs.map((spec) => ({
    spec,
    record: overrides.get(spec.id),
    values: (crosshairValues ?? latestValuesRef.current)[spec.id],
    ...(spec.placement === 'pane' ? { paneTop: paneTops.get(spec.id) } : {}),
  }))
  const selectedDrawing = drawings.find((item) => item.id === selectedDrawingId)
  // When the current (forming) bar closes, in epoch ms — the bar interval is the spacing of the
  // last two bars (evenly spaced within a timeframe). Shown as a live countdown only at the real-
  // time edge and when not hovering an older bar. null while there is nothing to time.
  // The bar spacing in seconds — the current bar's close countdown AND the measure tool's time
  // span both derive from it.
  const barIntervalSeconds = useMemo(
    () =>
      candles.length >= 2 && candles.at(-1)!.time - candles.at(-2)!.time > 0
        ? candles.at(-1)!.time - candles.at(-2)!.time
        : null,
    [candles],
  )
  const barCloseAt =
    barIntervalSeconds != null ? (candles.at(-1)!.time + barIntervalSeconds) * 1000 : null
  const countdownCloseAt = !away && !hovering ? barCloseAt : null
  return (
    <div className="absolute inset-0" aria-busy={loading}>
      <div ref={containerRef} className="absolute inset-0" />
      {loading && <ChartLoadingOverlay />}
      <IndicatorLegend
        entries={legendEntries}
        header={
          legend ? (
            <CrosshairReadout legend={legend} decimals={decimals} barCloseAt={countdownCloseAt} />
          ) : undefined
        }
        rightInset={rightAxisWidth + controlsWidth + 24}
        highlightedId={activeIndicatorId}
        onToggleHidden={(id) =>
          setIndicatorItems((prev) =>
            patchIndicatorPref(prev, id, {
              hidden: !(overrides.get(id)?.hidden === true),
            }),
          )
        }
        onRemove={(id) => {
          setIndicatorItems((prev) => toggleIndicatorV2(prev, id))
          if (selectedIndicatorId === id) setSelectedIndicatorId(null)
        }}
        onRekey={(fromId, toId) =>
          setIndicatorItems((prev) => rekeyIndicatorPref(prev, fromId, toId))
        }
        onPatch={(id, patch) => setIndicatorItems((prev) => patchIndicatorPref(prev, id, patch))}
      />
      <ChartCanvasControls
        controlsRef={controlsRef}
        rightAxisWidth={rightAxisWidth}
        chartWidth={chartSize.w}
        chartType={chartType}
        activeSpecs={activeSpecs}
        analysisMarket={analysisMarket}
        sessionHighlight={sessionHighlight}
        measuring={measuring}
        drawings={drawings}
        selectedDrawingId={selectedDrawingId}
        onChartType={(type) => setChartType((prev) => reduceChartType(prev, type))}
        onToggleIndicator={(id) => setIndicatorItems((prev) => toggleIndicatorV2(prev, id))}
        onClearIndicators={() =>
          setIndicatorItems((prev) => applyIndicatorCommandV2(prev, 'clear', []))
        }
        onApplyIndicators={(ids) =>
          setIndicatorItems((prev) => applyIndicatorCommandV2(prev, 'add', [...ids]))
        }
        onSessionHighlight={() => setSessionHighlight((value) => !value)}
        onMeasuring={() => {
          setMeasuring((value) => !value)
          setMeasure({ a: null, b: null })
        }}
        onClearAnalysis={(clearSelection) => {
          setDrawings((prev) => prev.filter((drawing) => !isDetectDrawingId(drawing.id)))
          if (clearSelection) {
            setSelectedDrawingId(null)
            setSelectedDrawingPoint(null)
          }
        }}
        onClearAll={() => {
          setIndicatorItems((prev) => applyIndicatorCommandV2(prev, 'clear', []))
          setDrawings((prev) => applyDrawCommand(prev, 'clear'))
          setSelectedIndicatorId(null)
          setSelectedDrawingId(null)
          setSelectedDrawingPoint(null)
        }}
      />
      {measuring && (
        <MeasureOverlay
          measure={measure}
          decimals={decimals}
          intervalSeconds={barIntervalSeconds}
        />
      )}
      {selectedDrawingId && selectedDrawingPoint && selectedDrawing && (
        <SelectedDrawingAction
          drawing={selectedDrawing}
          point={selectedDrawingPoint}
          rightAxisWidth={rightAxisWidth}
          onRemove={() => {
            setDrawings((prev) => applyDrawCommand(prev, 'remove', undefined, selectedDrawingId))
            setSelectedDrawingId(null)
            setSelectedDrawingPoint(null)
          }}
        />
      )}
      {away && (
        <LiveButton
          onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
          rightInset={rightAxisWidth + 8}
        />
      )}
    </div>
  )
})
