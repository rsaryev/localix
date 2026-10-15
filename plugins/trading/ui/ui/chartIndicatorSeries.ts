import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import type { IndicatorSpec } from '../model/indicators'
import type { IndicatorPrefRecord } from '../model/indicatorPrefs'
import type { IndicatorPoint } from '../model/indicator-contracts'
import { indicatorTailStart } from '../model/indicatorTail'
import { BandFillPrimitive } from './bandFillPrimitive'

/** Readable default for one oscillator pane without letting it rival the price pane. */
export const DEFAULT_INDICATOR_PANE_HEIGHT = 96

export type IndicatorSeries = ISeriesApi<'Line' | 'Histogram'>
export type IndicatorSeriesMap = Map<string, IndicatorSeries[]>

interface RebuildIndicatorSeriesOptions {
  chart: IChartApi
  specs: readonly IndicatorSpec[]
  overrides: ReadonlyMap<string, IndicatorPrefRecord>
  candles: Candle[]
  seriesById: IndicatorSeriesMap
  fillsById: Map<string, BandFillPrimitive>
  paneOwners: Map<number, string>
}

/**
 * Rebuild chart-owned indicator objects in canonical catalog order.
 *
 * lightweight-charts removes an empty pane with its last series, so a full rebuild is the
 * deterministic operation when the enabled set or a pane-affecting preference changes. Streaming
 * candle updates use {@link feedIndicator} and do not pass through this slower path.
 */
export function rebuildIndicatorSeries({
  chart,
  specs,
  overrides,
  candles,
  seriesById,
  fillsById,
  paneOwners,
}: RebuildIndicatorSeriesOptions): Record<string, Record<string, number>> {
  for (const owned of seriesById.values()) {
    for (const series of owned) chart.removeSeries(series)
  }
  seriesById.clear()
  fillsById.clear()
  paneOwners.clear()

  const values: Record<string, Record<string, number>> = {}
  let nextPane = 1
  for (const spec of specs) {
    const override = overrides.get(spec.id)
    const hidden = override?.hidden === true
    const paneIndex = spec.placement === 'overlay' ? 0 : nextPane++
    if (spec.placement === 'pane') paneOwners.set(paneIndex, spec.id)

    const range =
      spec.placement === 'pane' && !override?.rangeAuto
        ? (override?.range ?? spec.defaultRange)
        : undefined
    const autoscaleInfoProvider = range
      ? () => ({ priceRange: { minValue: range.min, maxValue: range.max } })
      : undefined
    const primaryIndex = Math.max(
      spec.series.findIndex((series) => series.type === 'line'),
      0,
    )
    const owned: IndicatorSeries[] = []

    spec.series.forEach((seriesSpec, seriesIndex) => {
      const color =
        seriesIndex === primaryIndex && override?.color ? override.color : seriesSpec.color
      const common = {
        color,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: !hidden,
        ...(autoscaleInfoProvider ? { autoscaleInfoProvider } : {}),
        ...(spec.valueFormat === 'volume' ? { priceFormat: { type: 'volume' as const } } : {}),
      }
      owned.push(
        seriesSpec.type === 'histogram'
          ? chart.addSeries(HistogramSeries, common, paneIndex)
          : chart.addSeries(
              LineSeries,
              {
                ...common,
                lineWidth: seriesSpec.lineWidth ?? 1,
                crosshairMarkerVisible: false,
                ...(seriesSpec.stepped ? { lineType: LineType.WithSteps } : {}),
              },
              paneIndex,
            ),
      )
    })

    if (!hidden) {
      for (const level of spec.levels ?? []) {
        owned[0]?.createPriceLine({
          price: level,
          color: '#8b8fa366',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: '',
        })
      }
    }
    if (spec.fill && owned[0]) {
      const fill = new BandFillPrimitive(spec.fill.up, spec.fill.down)
      fill.setVisible(!hidden)
      owned[0].attachPrimitive(fill)
      fillsById.set(spec.id, fill)
    }

    seriesById.set(spec.id, owned)
    values[spec.id] = feedIndicator(spec, owned, candles, fillsById.get(spec.id))
    if (spec.placement === 'pane') {
      chart.panes()[paneIndex]?.setHeight(override?.paneHeight ?? DEFAULT_INDICATOR_PANE_HEIGHT)
    }
  }
  return values
}

interface StyleIndicatorSeriesOptions {
  specs: readonly IndicatorSpec[]
  activeId: string | null
  overrides: ReadonlyMap<string, IndicatorPrefRecord>
  seriesById: IndicatorSeriesMap
}

/** Apply hover/selection emphasis without rebuilding or re-feeding any series. */
export function styleIndicatorSeries({
  specs,
  activeId,
  overrides,
  seriesById,
}: StyleIndicatorSeriesOptions): void {
  for (const spec of specs) {
    const owned = seriesById.get(spec.id)
    if (!owned) continue
    const isActive = activeId === spec.id
    const dim = activeId !== null && !isActive
    const primaryIndex = Math.max(
      spec.series.findIndex((series) => series.type === 'line'),
      0,
    )
    spec.series.forEach((seriesSpec, index) => {
      if (seriesSpec.type !== 'line') return
      const normalWidth = seriesSpec.lineWidth ?? 1
      const override = overrides.get(spec.id)
      const baseColor =
        index === primaryIndex && override?.color ? override.color : seriesSpec.color
      ;(owned[index] as ISeriesApi<'Line'> | undefined)?.applyOptions({
        lineWidth: isActive ? (Math.min(normalWidth + 2, 4) as 1 | 2 | 3 | 4) : normalWidth,
        color: dim ? fadedColor(baseColor) : baseColor,
      })
    })
  }
}

/** The points each mounted series last received — the baseline for a tail-only update. */
const fedPoints = new WeakMap<IndicatorSeries, readonly IndicatorPoint[]>()

/**
 * Push recomputed points to one series. A streaming tick usually changes only the last point, so
 * when the change is confined to the tail the series takes `update()` calls instead of a full
 * `setData` re-ingest; anything else (a fresh series, a repaint, a reset) reloads it.
 */
function pushPoints(series: IndicatorSeries, points: readonly IndicatorPoint[]): void {
  const previous = fedPoints.get(series)
  const start = previous ? indicatorTailStart(previous, points) : null
  if (start === null) series.setData(points as never)
  else for (let i = start; i < points.length; i++) series.update(points[i] as never)
  fedPoints.set(series, points)
}

/** Feed one indicator's parallel series array and return its newest values. */
export function feedIndicator(
  spec: IndicatorSpec,
  owned: IndicatorSeries[],
  candles: Candle[],
  fill?: BandFillPrimitive,
): Record<string, number> {
  const data = spec.compute(candles)
  const latest: Record<string, number> = {}
  spec.series.forEach((seriesSpec, index) => {
    const points = data[seriesSpec.key] ?? []
    const series = owned[index]
    if (series) pushPoints(series, points)
    const last = points[points.length - 1]
    if (last && typeof last.value === 'number') latest[seriesSpec.key] = last.value
  })
  if (fill && spec.fill) fill.setData(data[spec.fill.a] ?? [], data[spec.fill.b] ?? [])
  return latest
}

function fadedColor(color: string): string {
  if (!color.startsWith('#')) return color
  const hex = color.slice(1)
  if (hex.length === 6) return `#${hex}4d`
  if (hex.length === 8) {
    const alpha = Math.round(Number.parseInt(hex.slice(6), 16) * 0.3)
    return `#${hex.slice(0, 6)}${alpha.toString(16).padStart(2, '0')}`
  }
  return color
}
