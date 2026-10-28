/**
 * Builds the reply to a `manage_chart action:'snapshot'` command — the UI half of the
 * `chart-snapshot.ts` wire contract. Strictly read-only: a MOUNTED tab answers from
 * `chartStateStore` (live state the chart publishes as it changes); an unmounted/never-opened tab
 * answers `mounted: false` with the last-known store entry, or failing that the remembered
 * PREFERENCES (what the tab would open with) — never by opening anything.
 */

import type { ChartSnapshotResult } from '../../backend/chart-snapshot'
import type { StorageReader } from '@localixai/mini-app-sdk/ui/storage'
import { loadDrawings } from './chartDrawings'
import { chartStateStore } from './chartStateStore'
import { loadChartType } from './chartType'
import { loadIndicatorPrefsV2 } from './indicatorPrefs'
import { loadTimeframe } from './timeframePref'

export function buildChartSnapshot(
  /** The chat whose agent asked — its chart of this market is the one that answers. */
  sessionId: string,
  tabId: string,
  connectionId: string,
  symbol: string,
  storage?: StorageReader,
): ChartSnapshotResult {
  const state = chartStateStore.get(sessionId, tabId)
  if (state) {
    return {
      mounted: state.mounted,
      // Identity comes from the command's target (it IS the store key), not the entry.
      connectionId,
      symbol,
      ...(state.timeframe ? { timeframe: state.timeframe } : {}),
      ...(state.chartType ? { chartType: state.chartType } : {}),
      ...(state.indicators ? { indicators: state.indicators } : {}),
      ...(state.hiddenIndicators && state.hiddenIndicators.length > 0
        ? { hiddenIndicators: state.hiddenIndicators }
        : {}),
      ...(state.scaleMode ? { scaleMode: state.scaleMode } : {}),
      // Drawings persist per tab, so they are honest even for an unmounted tab.
      ...(state.drawings && state.drawings.length > 0 ? { drawings: state.drawings } : {}),
      // Viewport/candle facts are only honest while the chart is on screen.
      ...(state.mounted && state.visibleRange ? { visibleRange: state.visibleRange } : {}),
      ...(state.mounted && state.lastCandle ? { lastCandle: state.lastCandle } : {}),
      // COMPUTED indicator values exist only where the chart computed them. An unmounted tab
      // reports its indicator ids but no numbers — claiming a stale RSI as the current one
      // would be a lie the agent cannot detect.
      ...(state.mounted && state.indicatorValues ? { indicatorValues: state.indicatorValues } : {}),
    }
  }
  // Never opened this page session: report the remembered preferences the tab WOULD open with.
  // Timeframe is per-connection; chart type, indicators and drawings are the tab's own per-tab
  // prefs.
  const timeframe = loadTimeframe(connectionId, storage)
  const drawings = loadDrawings(tabId, storage)
  const prefs = loadIndicatorPrefsV2(tabId, storage)
  const hidden = prefs.items.flatMap((record) => (record.hidden ? [record.id] : []))
  return {
    mounted: false,
    connectionId,
    symbol,
    ...(timeframe ? { timeframe } : {}),
    chartType: loadChartType(tabId, storage),
    indicators: prefs.items.map((r) => r.id),
    ...(hidden.length > 0 ? { hiddenIndicators: hidden } : {}),
    ...(prefs.scaleMode ? { scaleMode: prefs.scaleMode } : {}),
    ...(drawings.length > 0 ? { drawings } : {}),
  }
}
