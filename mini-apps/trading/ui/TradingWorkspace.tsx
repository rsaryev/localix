import { useEffect, useState } from 'react'
import { CandlestickChart, Gauge } from 'lucide-react'

import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { PublicMarketsSidebar } from './ui/PublicMarketsSidebar'
import { TradingOverview } from './TradingOverview'
import { loadTradingArea, saveTradingArea, type TradingArea } from './model/tradingArea'

const AREA_META: Array<{
  area: TradingArea
  label: string
  Icon: typeof Gauge
}> = [
  { area: 'overview', label: 'Overview', Icon: Gauge },
  { area: 'markets', label: 'Markets', Icon: CandlestickChart },
]

/**
 * One root surface for market discovery, charting and account-aware trading tools.
 *
 * Areas mount lazily and stay mounted after their first visit, preserving venue,
 * filter, favourites and their last-good snapshots while the user moves around
 * the workspace.
 */
export function TradingWorkspace({
  sessionId,
  requestedArea,
  active = true,
}: {
  /** The chat this workspace belongs to — where the charts it opens land. */
  sessionId: string
  requestedArea?: TradingArea
  active?: boolean
}) {
  const [area, setAreaState] = useState<TradingArea>(() => requestedArea ?? loadTradingArea())
  const [visited, setVisited] = useState(() => new Set<TradingArea>([area]))

  const setArea = (next: TradingArea) => {
    setVisited((current) => new Set(current).add(next))
    setAreaState(next)
    saveTradingArea(next)
  }

  // A requested area (a link, a chip) is applied while rendering; only remembering it, a side
  // effect, waits for the commit.
  const [appliedArea, setAppliedArea] = useState<TradingArea | undefined>(undefined)
  if (requestedArea !== appliedArea) {
    setAppliedArea(requestedArea)
    if (requestedArea) {
      setVisited((current) => new Set(current).add(requestedArea))
      setAreaState(requestedArea)
    }
  }
  useEffect(() => {
    if (requestedArea) saveTradingArea(requestedArea)
  }, [requestedArea])

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <WorkbenchToolbar as="header" aria-label="Trading workspace sections">
        <SegmentedControl variant="muted" aria-label="Trading Workspace sections">
          {AREA_META.map(({ area: candidate, label, Icon }) => (
            <SegmentedControlItem
              key={candidate}
              active={area === candidate}
              onClick={() => setArea(candidate)}
              title={label}
              className="min-w-0 px-2.5"
            >
              <Icon className="size-3" />
              <span className="truncate">{label}</span>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </WorkbenchToolbar>

      <div className="min-h-0 flex-1">
        {visited.has('overview') && (
          <div className={area === 'overview' ? 'h-full min-h-0' : 'hidden'}>
            <TradingOverview onOpen={setArea} active={active && area === 'overview'} />
          </div>
        )}
        {visited.has('markets') && (
          <div className={area === 'markets' ? 'h-full min-h-0' : 'hidden'}>
            <PublicMarketsSidebar
              sessionId={sessionId}
              embedded
              active={active && area === 'markets'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
