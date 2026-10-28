/**
 * The market category tabs — All / Favourites / one per market type — shared by the chart
 * header's market picker and the markets sidebar.
 *
 * Both surfaces used to carry their own copy of this state: the same roster derivation, the
 * same reset, the same wrap-around cycling, written twice and already drifting (one bar was a
 * `tablist` with `aria-selected`, the other a row of `aria-pressed` toggles). The rules live
 * here once:
 *
 *  - the tabs are derived from the UNFILTERED roster (an empty query), so typing never makes a
 *    per-type tab appear or vanish under the cursor;
 *  - a new `resetKey` (the picker reopening, the sidebar switching venue) collapses to the
 *    always-present pair and selects All until that roster arrives;
 *  - cycling wraps, and an unknown current tab cycles from the start.
 */
import { useCallback, useState } from 'react'
import type { Market } from '../../backend/contracts'
import { ALL_TAB, FAVOURITES_TAB, buildMarketTabs, type MarketPickerTab } from './marketPicker'

const BASE_TABS: MarketPickerTab[] = [ALL_TAB, FAVOURITES_TAB]

export interface MarketTabs {
  tab: string
  setTab: (key: string) => void
  tabs: MarketPickerTab[]
  cycleTab: (dir: 1 | -1) => void
}

export function useMarketTabs(opts: {
  markets: readonly Market[]
  query: string
  /** Changing it resets to the base pair and All. */
  resetKey: unknown
  /** Derive from the roster only while the surface is live (the picker is open). */
  enabled?: boolean
}): MarketTabs {
  const { markets, query, resetKey, enabled = true } = opts
  const [tab, setTab] = useState<string>(ALL_TAB.key)
  const [tabs, setTabs] = useState<MarketPickerTab[]>(BASE_TABS)

  // Both follow their inputs while rendering (no effect, so no extra render with stale tabs):
  // a new reset key collapses to the base pair and All...
  const [seenResetKey, setSeenResetKey] = useState(resetKey)
  if (!Object.is(seenResetKey, resetKey)) {
    setSeenResetKey(resetKey)
    setTab(ALL_TAB.key)
    setTabs(BASE_TABS)
  }
  // ...and the roster, while the surface is live, rebuilds the per-type tabs.
  const [seenRoster, setSeenRoster] = useState<{
    enabled: boolean
    query: string
    markets: readonly Market[]
  } | null>(null)
  if (
    !seenRoster ||
    seenRoster.enabled !== enabled ||
    seenRoster.query !== query ||
    seenRoster.markets !== markets
  ) {
    setSeenRoster({ enabled, query, markets })
    if (enabled && query.trim() === '' && markets.length > 0) setTabs(buildMarketTabs(markets))
  }

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      setTab((current) => {
        const index = tabs.findIndex((t) => t.key === current)
        return tabs[(Math.max(0, index) + dir + tabs.length) % tabs.length]?.key ?? ALL_TAB.key
      })
    },
    [tabs],
  )

  return { tab, setTab, tabs, cycleTab }
}
