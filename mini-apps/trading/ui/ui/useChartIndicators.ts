/**
 * The indicator set: persisted pref records (presence = active, each with its overrides) plus the
 * main scale's mode, and the series each active indicator owns on the chart.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { resolveIndicators } from '../model/indicatorSpecs'
import {
  activeIds,
  loadIndicatorPrefsV2,
  saveIndicatorPrefsV2,
  type ChartScaleMode,
  type IndicatorPrefRecord,
} from '../model/indicatorPrefs'
import { rebuildIndicatorSeries, styleIndicatorSeries } from './chartIndicatorSeries'
import type { ChartRuntime } from './useChartRuntime'

export function useChartIndicatorState(rt: ChartRuntime, controlKey: string | undefined) {
  // All off by default — an always-on indicator the user cannot remove is clutter.
  const [items, setItems] = useState<IndicatorPrefRecord[]>(
    () => loadIndicatorPrefsV2(controlKey).items,
  )
  const [scaleMode, setScaleMode] = useState<ChartScaleMode>(
    () => loadIndicatorPrefsV2(controlKey).scaleMode ?? 'linear',
  )
  const active = useMemo(() => activeIds(items), [items])
  const overrides = useMemo(() => new Map(items.map((r) => [r.id, r])), [items])
  // RESOLVED drawable specs (parameterized — `ema:200` works as well as a preset), in
  // deterministic overlay-then-pane order.
  const activeSpecs = useMemo(() => resolveIndicators(active), [active])
  useLayoutEffect(() => {
    rt.write('activeSpecs', activeSpecs)
  }, [rt, activeSpecs])
  return { items, setItems, scaleMode, setScaleMode, activeSpecs, overrides }
}

export type ChartIndicatorState = ReturnType<typeof useChartIndicatorState>

export function useChartIndicatorSeries(
  rt: ChartRuntime,
  { items, scaleMode, activeSpecs, overrides }: ChartIndicatorState,
  activeIndicatorId: string | null,
  schedulePaneMeasure: () => void,
): void {
  // One write, one per-tab key.
  useEffect(() => {
    saveIndicatorPrefsV2(
      { v: 2, items, ...(scaleMode !== 'linear' ? { scaleMode } : {}) },
      rt.props.current.controlKey,
    )
  }, [rt, items, scaleMode])

  // (Re)build on any set/override change. A rebuild (teardown + create in catalog order) keeps
  // pane indices dense; a HIDDEN indicator keeps its series mounted (`visible: false`) so no pane
  // below renumbers. The data feed keeps the created series fed thereafter.
  useEffect(() => {
    const chart = rt.chart.current
    if (!chart) return
    const values = rebuildIndicatorSeries({
      chart,
      specs: activeSpecs,
      overrides,
      candles: rt.candles.current,
      seriesById: rt.indicatorSeries,
      fillsById: rt.fillPrims,
      paneOwners: rt.paneOwners,
    })
    rt.latestValues.current = values
    schedulePaneMeasure()
    rt.publish({
      indicators: activeSpecs.map((spec) => spec.id),
      hiddenIndicators: activeSpecs.flatMap((spec) =>
        overrides.get(spec.id)?.hidden === true ? [spec.id] : [],
      ),
      indicatorValues: values,
    })
    // schedulePaneMeasure is render-local but reads only the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, activeSpecs, overrides])

  // A hovered/selected indicator thickens; the rest recede to ~30% opacity until nothing is active.
  useEffect(() => {
    styleIndicatorSeries({
      specs: activeSpecs,
      activeId: activeIndicatorId,
      overrides,
      seriesById: rt.indicatorSeries,
    })
  }, [rt, activeSpecs, activeIndicatorId, overrides])
}
