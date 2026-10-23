import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { StorageReader } from '@localixai/mini-app-sdk/ui/storage'
import { DEFAULT_TIMEFRAME } from '../../backend/timeframes'

/**
 * The timeframe a chart opens on — remembered per connection, not reset to a default on every
 * mount.
 *
 * A trader reads one venue at one horizon: someone scalping minute bars does not want the chart to
 * come back on `1h` after a reload, and does not want to re-pick the timeframe for every market
 * they click through. Every exchange front-end (Hyperliquid's included) carries the timeframe
 * across market switches for exactly that reason. The preference is therefore keyed by connection,
 * mirroring `favourites.ts` — the market is what changes; the horizon is how you look at it.
 *
 * Pure selection lives in `pickTimeframe` so the venue-offers rule is unit-tested: a remembered
 * timeframe is honoured ONLY when the venue still offers it, because a chart cannot be drawn on a
 * bar size the exchange does not produce.
 */

const tfKey = (connId: string) => `localix.trading.tf.${connId}`

/** Fallbacks, in order, when nothing is remembered: the horizons a chart is most often read at. */
export const PREFERRED_TIMEFRAMES = ['1h', '15m', '1m', '4h', '1d']

/**
 * The timeframe a chart should open on.
 *
 * Matching is EXACT and case-sensitive, which is load-bearing: `1m` is a minute and `1M` is a
 * month — the only two timeframe tokens that differ by case alone. A case-insensitive match would
 * silently open a monthly chart for a scalper.
 *
 * `offered` is the venue's own timeframe list. An empty list (a venue that reports none) falls back
 * to `1h` rather than to a bar size we have no evidence exists.
 */
export function pickTimeframe(
  saved: string | null | undefined,
  offered: readonly string[],
  preferred: readonly string[] = PREFERRED_TIMEFRAMES,
): string {
  if (saved && offered.includes(saved)) return saved
  return preferred.find((t) => offered.includes(t)) ?? offered[0] ?? DEFAULT_TIMEFRAME
}

/** The connection's remembered timeframe, or `null` when none / malformed. */
export function loadTimeframe(connId: string, storage?: StorageReader): string | null {
  const raw = loadJSON<unknown>(tfKey(connId), storage)
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/** Remember `timeframe` for this connection's charts. */
export function saveTimeframe(connId: string, timeframe: string): void {
  saveJSON(tfKey(connId), timeframe)
}
