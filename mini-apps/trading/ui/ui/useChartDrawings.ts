/**
 * Drawings (hline / trendline / vline / markers), persisted PER TAB, and the ephemeral overlay
 * another surface lays on top of them. The drawing layer owns the chart-side objects.
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import type { ChartDrawing } from '../../backend/chart-drawing'
import { loadDrawings, saveDrawings, seriesMarkersOf } from '../model/chartDrawings'
import type { ChartRuntime } from './useChartRuntime'

/** What the chart SHOWS: the persisted list plus whatever overlay is live. Only the list is ever
 *  saved or published. */
export function syncDrawingLayer(rt: ChartRuntime, list: readonly ChartDrawing[]): void {
  const overlay = rt.props.current.overlay
  rt.drawingLayer.sync(overlay.length === 0 ? list : [...list, ...overlay])
}

/** The drawing list's state, mirrored into the runtime for the chart-type swap. */
export function useChartDrawingState(rt: ChartRuntime, controlKey: string | undefined) {
  const state = useState<ChartDrawing[]>(() => (controlKey ? loadDrawings(controlKey) : []))
  const [list] = state
  useLayoutEffect(() => {
    rt.write('drawings', list)
  }, [rt, list])
  return state
}

/**
 * Keep the chart's drawing objects, the per-tab persistence and the snapshot store in step with
 * the list. Runs AFTER the chart-type swap on mount, so the main series exists; a later swap
 * re-attaches by itself.
 */
export function useChartDrawingSync(
  rt: ChartRuntime,
  drawings: ChartDrawing[],
  overlay: readonly ChartDrawing[] | undefined,
  activeDrawingId: string | null,
): void {
  useEffect(() => {
    const key = rt.props.current.controlKey
    if (key) saveDrawings(key, drawings)
    syncDrawingLayer(rt, drawings)
    rt.markersPlugin.current?.setMarkers(seriesMarkersOf(drawings))
    rt.publish({ drawings })
  }, [rt, drawings])

  // The overlay changes as a trade is typed; nothing is saved or published for it.
  useEffect(() => {
    syncDrawingLayer(rt, rt.drawings.current)
  }, [rt, overlay])

  useEffect(() => rt.drawingLayer.highlight(activeDrawingId), [rt, activeDrawingId])
}
