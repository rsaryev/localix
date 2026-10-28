/**
 * Push candles into the series — incrementally where the change shape allows it. `update()` covers
 * a live tick AND a bar rollover; full `setData` is reserved for the initial load, prepends and
 * deep corrections: the difference between a cheap tick and rebuilding the chart on every quote.
 */
import { useEffect } from 'react'
import type { HistogramData, Time, UTCTimestamp, WhitespaceData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import { prependedBars, shiftedRange } from '../model/backfill'
import { classifyCandleUpdate, toVolumeData, type VolumeColors } from '../model/candleSeries'
import { mainSeriesData, mainSeriesPoint } from '../model/chartType'
import { buildCrosshairLegend } from '../model/crosshairLegend'
import { feedIndicator } from './chartIndicatorSeries'
import type { ChartInteraction } from './useChartPointer'
import type { ChartRuntime, IndicatorValues } from './useChartRuntime'

/**
 * One bar's point on the volume histogram. A bar the venue reported NO volume for maps to
 * WHITESPACE — `update()` then clears any stale column at that time instead of freezing it.
 * Mirrors `toVolumeData`, which simply skips such bars.
 */
function volumePoint(bar: Candle, colors: VolumeColors): HistogramData | WhitespaceData<Time> {
  const time = bar.time as UTCTimestamp
  if (bar.volume === undefined) return { time }
  return { time, value: bar.volume, color: bar.close >= bar.open ? colors.up : colors.down }
}

export function useChartDataFeed(
  rt: ChartRuntime,
  candles: Candle[],
  { hoveringRef, setLegend }: Pick<ChartInteraction, 'hoveringRef' | 'setLegend'>,
): void {
  useEffect(() => {
    const mainSeries = rt.mainSeries.current
    const volumeSeries = rt.volumeSeries.current
    if (!mainSeries || !volumeSeries) return

    const change = classifyCandleUpdate(rt.renderedCandles.current, candles)
    // Older bars push every logical index up; moving the viewport by the same amount keeps the
    // chart still while the void to its left fills in.
    const added = prependedBars(rt.firstBarTime.current, candles)
    rt.write('firstBarTime', candles[0]?.time ?? null)

    const pushBar = (bar: Candle) => {
      mainSeries.update(mainSeriesPoint(rt.chartType.current, bar) as never)
      volumeSeries.update(volumePoint(bar, rt.volumeColors.current))
    }
    switch (change.kind) {
      case 'none':
        break
      case 'tick':
        pushBar(change.bar)
        break
      case 'append':
        // The rollover finalises the closed bar AND opens the next one.
        if (change.corrected) pushBar(change.corrected)
        pushBar(change.bar)
        break
      case 'reset':
        mainSeries.setData(mainSeriesData(rt.chartType.current, candles) as never[])
        volumeSeries.setData(toVolumeData(candles, rt.volumeColors.current))
        break
    }
    rt.write('renderedCandles', candles)
    rt.sessionPrim.current?.setTimes(candles.map((c) => c.time))
    // Indicators are opt-in — nothing is computed while none are on. The latest values ride into
    // the snapshot store so the agent reads numbers, not ids.
    if (change.kind !== 'none' && rt.activeSpecs.current.length > 0) {
      const values: IndicatorValues = {}
      for (const spec of rt.activeSpecs.current) {
        const owned = rt.indicatorSeries.get(spec.id)
        if (owned) values[spec.id] = feedIndicator(spec, owned, candles, rt.fillPrims.get(spec.id))
      }
      rt.latestValues.current = values
      rt.publish({ indicatorValues: values })
    }
    if (added > 0) {
      const ts = rt.chart.current?.timeScale()
      const range = ts?.getVisibleLogicalRange()
      if (ts && range) ts.setVisibleLogicalRange(shiftedRange(range, added))
    }
    // The legend's fallback (the newest bar) — never while the pointer owns it.
    if (!hoveringRef.current) {
      const last = candles.at(-1)
      setLegend(last ? buildCrosshairLegend(last, last.volume) : null)
    }
    const newest = candles.at(-1)
    if (newest) rt.publish({ lastCandle: { time: newest.time, close: newest.close } })
    // Keyed on the candles alone; everything else is read through the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles])
}
