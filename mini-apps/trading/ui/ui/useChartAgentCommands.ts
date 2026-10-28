import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { ITimeScaleApi, Time } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import type { ChartRuntime } from './useChartRuntime'
import type { ChartDrawing } from '../../backend/chart-drawing'
import { applyDrawCommand } from '../model/chartDrawings'
import { chartControlBus, type ChartControlCommand } from '../model/chartControlBus'
import { rangeAroundTime, zoomedRange } from '../model/chartNav'
import { reduceChartType, type ChartType } from '../model/chartType'
import {
  applyIndicatorCommandV2,
  patchIndicatorPref,
  type ChartScaleMode,
  type IndicatorPrefRecord,
} from '../model/indicatorPrefs'

type NavigateCommand = Extract<ChartControlCommand, { type: 'navigate' }>
type TimeScale = Pick<
  ITimeScaleApi<Time>,
  'scrollToRealTime' | 'fitContent' | 'getVisibleLogicalRange' | 'setVisibleLogicalRange'
>

/** Move the viewport for one `navigate` command; `to_time` centers the nearest LOADED bar. */
export function navigateTimeScale(
  ts: TimeScale,
  command: NavigateCommand,
  candles: readonly Candle[],
): void {
  if (command.op === 'to_realtime') return ts.scrollToRealTime()
  if (command.op === 'fit') return ts.fitContent()
  const range = ts.getVisibleLogicalRange()
  if (command.op === 'zoom_in' || command.op === 'zoom_out') {
    if (range) ts.setVisibleLogicalRange(zoomedRange(range, command.op === 'zoom_in' ? 0.5 : 2))
    return
  }
  if (command.op === 'to_time') {
    const span = range ? range.to - range.from : 120
    const next = rangeAroundTime(candles, command.time, span)
    if (next) ts.setVisibleLogicalRange(next)
  }
}

interface ChartAgentCommandTargets {
  controlKey: string | undefined
  controlSessionId: string | undefined
  /** The canvas's runtime: the chart to navigate and the candles to navigate over. */
  runtime: ChartRuntime
  setIndicatorItems: Dispatch<SetStateAction<IndicatorPrefRecord[]>>
  setScaleMode: Dispatch<SetStateAction<ChartScaleMode>>
  setChartType: Dispatch<SetStateAction<ChartType>>
  setDrawings: Dispatch<SetStateAction<ChartDrawing[]>>
}

/**
 * Agent commands (manage_chart → chartControlBus, keyed by this chat and chart tab). The canvas
 * owns indicators, chart type and the viewport; the timeframe command is the TAB's (it owns that
 * state) — both subscribe under the same key and each handles its own concern.
 */
export function useChartAgentCommands({
  controlKey,
  controlSessionId,
  runtime,
  setIndicatorItems,
  setScaleMode,
  setChartType,
  setDrawings,
}: ChartAgentCommandTargets): void {
  useEffect(() => {
    if (!controlKey || !controlSessionId) return
    return chartControlBus.subscribe(controlSessionId, controlKey, (command) => {
      switch (command.type) {
        case 'set_indicators':
          return setIndicatorItems((prev) =>
            applyIndicatorCommandV2(prev, command.mode, command.ids),
          )
        case 'configure_indicator':
          return setIndicatorItems((prev) => patchIndicatorPref(prev, command.id, command.patch))
        case 'set_scale_mode':
          return setScaleMode(command.mode)
        case 'set_chart_type':
          return setChartType((prev) => reduceChartType(prev, command.chartType))
        case 'draw':
          return setDrawings((prev) =>
            applyDrawCommand(prev, command.mode, command.drawing, command.id),
          )
        case 'navigate': {
          const chart = runtime.chart.current
          if (chart) navigateTimeScale(chart.timeScale(), command, runtime.candles.current)
          break
        }
        case 'set_timeframe':
          // The tab owns the timeframe and answers this command on its own subscription.
          break
      }
    })
    // The setters are stable and the refs are read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlKey, controlSessionId])
}
