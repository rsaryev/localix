/**
 * The chart itself: one lightweight-charts instance, and the hooks that keep it in step with React.
 *
 * The chart is ONE imperative object React does not own; every hook below reaches into it through
 * the shared {@link ChartRuntime} (chart, series, and prop mirrors as ref boxes), so the next
 * effect sees what the last one did without a re-render. The hooks are called in the order their
 * effects must run — chart created, main series mounted, drawings attached, indicators built,
 * appearance applied, data pushed, pointer handlers subscribed — and that order is load-bearing.
 */
import { memo, useLayoutEffect, useMemo, useState } from 'react'
import type { Candle } from '../../backend/contracts'
import type { ChartDrawing } from '../../backend/chart-drawing'
import { loadJSON } from '@localixai/mini-app-sdk/ui/storage'
import {
  applyIndicatorCommandV2,
  patchIndicatorPref,
  rekeyIndicatorPref,
  toggleIndicatorV2,
} from '../model/indicatorPrefs'
import { loadChartType, reduceChartType, type ChartType } from '../model/chartType'
import { applyDrawCommand, isDetectDrawingId } from '../model/chartDrawings'
import type { ChartPriceFormat } from '../model/formatQuote'
import type { AnalysisMarket } from './ChartAnalysisMenu'
import { IndicatorLegend, type IndicatorLegendEntry } from './IndicatorLegend'
import { ChartCanvasControls } from './ChartCanvasControls'
import {
  ChartLoadingOverlay,
  CrosshairReadout,
  LiveButton,
  MeasureOverlay,
  SelectedDrawingAction,
} from './ChartCanvasOverlays'
import { useChartAgentCommands } from './useChartAgentCommands'
import { useChartDataFeed } from './useChartDataFeed'
import { useChartDrawingState, useChartDrawingSync } from './useChartDrawings'
import { useChartIndicatorSeries, useChartIndicatorState } from './useChartIndicators'
import { useChartInstance } from './useChartInstance'
import { useChartInteraction, useChartPointer } from './useChartPointer'
import { useChartRuntime } from './useChartRuntime'
import { SESSION_HIGHLIGHT_KEY, useChartAppearance, useChartMainSeries } from './useChartSeries'

/** Stable empty overlay — a fresh `[]` each render would defeat the memo and the effect dep. */
const EMPTY_OVERLAY: readonly ChartDrawing[] = []

/**
 * The lightweight-charts canvas. Memoized: the parent tab re-renders on every ticker push, but
 * this canvas only needs to react when the candles themselves (or theme/format) change.
 */
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
  const rt = useChartRuntime(candles, {
    priceFormat,
    controlKey,
    controlSessionId,
    onLoadOlder,
    overlay: overlayDrawings ?? EMPTY_OVERLAY,
  })
  const { setContainer } = rt
  // Chart type, drawings and the indicator set are per-tab (keyed by controlKey).
  const [chartType, setChartType] = useState<ChartType>(() => loadChartType(controlKey))
  useLayoutEffect(() => {
    rt.write('chartType', chartType)
  }, [rt, chartType])
  const [sessionHighlight, setSessionHighlight] = useState(
    () => loadJSON<boolean>(SESSION_HIGHLIGHT_KEY) === true,
  )
  const indicators = useChartIndicatorState(rt, controlKey)
  const { activeSpecs, overrides, setItems: setIndicatorItems, setScaleMode } = indicators
  const [drawings, setDrawings] = useChartDrawingState(rt, controlKey)
  const ix = useChartInteraction()
  const { selectedIndicatorId, setSelectedIndicatorId, selectedDrawingId } = ix
  const { setSelectedDrawingId, selectedDrawingPoint, setSelectedDrawingPoint } = ix
  const { measuring, setMeasuring, setMeasure } = ix

  // Effects run in this order — see the header.
  const layout = useChartInstance(rt, sessionHighlight, setIndicatorItems)
  const { chartSize, rightAxisWidth, controlsWidth, controlsRef, paneTops } = layout
  useChartMainSeries(rt, chartType, priceFormat)
  useChartDrawingSync(rt, drawings, overlayDrawings, ix.activeDrawingId)
  useChartIndicatorSeries(rt, indicators, ix.activeIndicatorId, layout.schedulePaneMeasure)
  useChartAppearance(rt, theme, indicators.scaleMode, sessionHighlight)
  useChartDataFeed(rt, candles, ix)
  useChartPointer(rt, ix)
  useChartAgentCommands({
    controlKey,
    controlSessionId,
    runtime: rt,
    setIndicatorItems,
    setScaleMode,
    setChartType,
    setDrawings,
  })

  const decimals = priceFormat.precision
  // One row per active indicator: values follow the crosshair while hovering, else the latest
  // computed ones the feed path already produced (no second compute for the legend).
  const legendEntries: IndicatorLegendEntry[] = activeSpecs.map((spec) => ({
    spec,
    record: overrides.get(spec.id),
    values: (ix.crosshairValues ?? rt.latestValues.current)[spec.id],
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
  const countdownCloseAt = !ix.away && !ix.hovering ? barCloseAt : null
  return (
    <div className="absolute inset-0" aria-busy={loading}>
      <div ref={setContainer} className="absolute inset-0" />
      {loading && <ChartLoadingOverlay />}
      <IndicatorLegend
        entries={legendEntries}
        header={
          ix.legend ? (
            <CrosshairReadout
              legend={ix.legend}
              decimals={decimals}
              barCloseAt={countdownCloseAt}
            />
          ) : undefined
        }
        rightInset={rightAxisWidth + controlsWidth + 24}
        highlightedId={ix.activeIndicatorId}
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
          measure={ix.measure}
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
      {ix.away && (
        <LiveButton
          onClick={() => rt.chart.current?.timeScale().scrollToRealTime()}
          rightInset={rightAxisWidth + 8}
        />
      )}
    </div>
  )
})
