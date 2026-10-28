import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickChart, Star } from 'lucide-react'
import type { ExchangeCatalogEntry, Market } from '../../backend/contracts'
import { DEFAULT_PUBLIC_EXCHANGE_ID, publicConnectionId } from '../../backend/public-connection'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { marketRowMenu } from './marketRowMenu'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { SearchInput } from '@localixai/kit/search-input'
import { Select } from '@localixai/kit/select'
import { Button } from '@localixai/kit/button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { useInfiniteScroll } from '@localixai/mini-app-sdk/ui/visibility'
import { tradingApi } from '../api/tradingApi'
import { loadFavourites, toggleFavourite } from '../model/favourites'
import { marketListState } from '../model/marketListState'
import { marketRowSubtitle } from '../model/marketBadges'
import { openTradingChartTab } from '../model/openTab'
import { ProblemState } from '@localixai/mini-app-sdk/ui/components'
import { useTradingProblem } from '../problems'
import { useMarkets } from '../model/useMarkets'
import { marketResourceUri, setMarketMessageBindingDrag } from '../model/marketDrag'
import { FAVOURITES_TAB, filterMarketRows } from '../model/marketPicker'
import { useMarketTabs } from '../model/useMarketTabs'
import { MarketTabStrip } from './MarketTabStrip'

// One generous ranked page (per-type fair share via `rankMarkets`); the flat list under a tab is
// revealed progressively, so a large page never renders all at once.
const REQUEST_LIMIT = 500
// Rows shown initially and added per scroll step.
const REVEAL_STEP = 60

const DEFAULT_EXCHANGE: ExchangeCatalogEntry = {
  id: DEFAULT_PUBLIC_EXCHANGE_ID,
  name: 'Hyperliquid',
  requiredCredentials: [],
}

/** Public market browser. It deliberately owns no credentials, account state, or trade actions:
 * switching a venue only replaces the ephemeral data source used by charts and the book.
 *
 * Mirrors the chart-header MARKET PICKER's shape — a category tab bar (All / Favourites / one tab
 * per market type the venue reports / Third-party) over a single flat, ranked list — so the two
 * surfaces browse the venue the same way and never disagree about the slice. The list is revealed
 * progressively on scroll; server search hits the whole roster within the active tab. */
export function PublicMarketsSidebar({
  sessionId,
  embedded = false,
  active = true,
}: {
  /** The chat whose workspace a chosen market's chart opens in — the Trading tab's own. */
  sessionId: string
  embedded?: boolean
  active?: boolean
}) {
  const [exchangeId, setExchangeId] = useState(DEFAULT_PUBLIC_EXCHANGE_ID)
  const [exchanges, setExchanges] = useState<ExchangeCatalogEntry[]>([DEFAULT_EXCHANGE])
  const [filter, setFilter] = useState('')
  const [favourites, setFavourites] = useState<Set<string>>(() =>
    loadFavourites(publicConnectionId(DEFAULT_PUBLIC_EXCHANGE_ID)),
  )
  const [reloadNonce, setReloadNonce] = useState(0)
  const [revealCount, setRevealCount] = useState(REVEAL_STEP)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void tradingApi
      .exchanges()
      .then((catalog) => {
        if (cancelled) return
        const withDefault = catalog.some((exchange) => exchange.id === DEFAULT_PUBLIC_EXCHANGE_ID)
          ? catalog
          : [DEFAULT_EXCHANGE, ...catalog]
        setExchanges(
          [...withDefault].sort((a, b) =>
            a.id === DEFAULT_PUBLIC_EXCHANGE_ID
              ? -1
              : b.id === DEFAULT_PUBLIC_EXCHANGE_ID
                ? 1
                : a.name.localeCompare(b.name),
          ),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active])

  const sourceId = publicConnectionId(exchangeId)
  const markets = useMarkets(sourceId, active, filter, reloadNonce, REQUEST_LIMIT)
  // Re-read localStorage only when the venue changes; a toggle below sets the new set directly.
  const [favouritesSource, setFavouritesSource] = useState(sourceId)
  if (favouritesSource !== sourceId) {
    setFavouritesSource(sourceId)
    setFavourites(loadFavourites(sourceId))
  }

  // The same category tabs as the chart picker; a venue switch resets them (`useMarketTabs`).
  const { tab, setTab, tabs } = useMarketTabs({
    markets: markets.markets,
    query: filter,
    resetKey: sourceId,
  })

  const { rows, total, capped } = useMemo(
    () => filterMarketRows(markets.markets, { query: filter, tab, favourites }),
    [markets.markets, filter, tab, favourites],
  )

  // Reveal resets to the first slice on a tab switch or a new search — but NOT on a favourite toggle
  // (that keeps your scroll position). `total`/`capped` change with the query, not the reveal.
  const revealKey = `${tab}\n${filter}\n${sourceId}`
  const [revealFor, setRevealFor] = useState(revealKey)
  if (revealFor !== revealKey) {
    setRevealFor(revealKey)
    setRevealCount(REVEAL_STEP)
  }

  const shown = useMemo(() => rows.slice(0, revealCount), [rows, revealCount])
  const hasMore = revealCount < rows.length
  const sentinelRef = useInfiniteScroll(() => setRevealCount((n) => n + REVEAL_STEP), hasMore)
  const state = marketListState(markets, rows.length)
  // Owned above the branch that draws it: the branch is gone the moment the venue answers.
  const marketsProblem = useTradingProblem({
    subject: `${sourceId} markets`,
    failure: state === 'error' ? markets.error : null,
    onRetry: () => setReloadNonce((v) => v + 1),
  })

  const openMarket = useCallback(
    (market: Market) => {
      const name = exchanges.find((exchange) => exchange.id === exchangeId)?.name ?? exchangeId
      openTradingChartTab(sessionId, {
        connectionId: sourceId,
        exchangeId,
        symbol: market.symbol,
        name: `${market.symbol} · ${name}`,
        connectionName: name,
      })
    },
    [exchangeId, exchanges, sessionId, sourceId],
  )
  const toggleFav = useCallback(
    (symbol: string) => {
      setFavourites(toggleFavourite(sourceId, symbol))
    },
    [sourceId],
  )

  // No ground coat in either mount: embedded it fills the workspace pane, standalone it fills the
  // host's sidebar panel, and both of those already paint their ground. Under the host's macOS
  // glass theme the tokens carry alpha, so a second pane-sized coat compounded into an opaque
  // slab — which is also why the mount no longer has to know WHICH ground it is sitting on.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Embedded, this pane sits directly under Trading Workspace's section toolbar, whose
          active segment already reads "Markets". A panel header there spent a second
          36px row and a second seam repeating it. Both DevOps inventories solved the same
          junction the same way — `{!embedded && <PanelHeader/>}` with the header's action
          moving into the control row below (docker/ui/ui/DockerSidebarHeader.tsx,
          kubernetes/ui/ui/KubernetesSidebarHeader.tsx). */}
      {!embedded && (
        <PanelHeader
          title="Markets"
          tone="sidebar"
          actions={
            <RefreshAction
              size="sm"
              aria-label="Refresh market list"
              tooltip="Refresh market list"
              busy={markets.loading}
              onClick={() => setReloadNonce((value) => value + 1)}
            />
          }
        />
      )}

      {/* `px-3`: the same content edge as the panel header above and the market rows below,
          which was `p-2.5` here and `px-2` on the category bar — three gutters down one
          column. `px-3 py-2` is the workbench control-row measure the DevOps sidebars are
          pinned to. */}
      <WorkbenchToolbar
        layout="stacked"
        aria-label="Market filters"
        tone={embedded ? 'content' : 'sidebar'}
        className={cn(embedded ? 'bg-surface-raised/20' : 'bg-sidebar/70')}
      >
        <div>
          <span className="mb-1 block text-2xs text-text-faint">Data source</span>
          <div className="flex items-center gap-1.5">
            <Select
              size="md"
              aria-label="Market data source"
              className="min-w-0 flex-1"
              value={exchangeId}
              onValueChange={setExchangeId}
              options={exchanges.map((exchange) => ({ value: exchange.id, label: exchange.name }))}
            />
            {embedded && (
              <RefreshAction
                size="sm"
                aria-label="Refresh market list"
                tooltip="Refresh market list"
                busy={markets.loading}
                onClick={() => setReloadNonce((value) => value + 1)}
              />
            )}
          </div>
        </div>
        <SearchInput
          value={filter}
          onValueChange={setFilter}
          placeholder="Search markets…"
          tone={embedded ? 'default' : 'sidebar'}
          size="md"
        />
      </WorkbenchToolbar>

      {/* Category tabs — derived from the roster, like the chart picker; ←/→ move within the bar. */}
      <MarketTabStrip
        tabs={tabs}
        active={tab}
        onChange={setTab}
        tone={embedded ? 'default' : 'sidebar'}
        className="px-3"
      />

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {state === 'loading' ? (
          <LoadingHint className="p-3">Loading markets…</LoadingHint>
        ) : state === 'unreachable' ? (
          // The dead-end states carry their own way out — the header's Refresh is the same action,
          // but it is disconnected from the message.
          <div className="flex flex-col items-center gap-1 p-4">
            <EmptyHint className="p-0">The venue is unreachable — try again shortly.</EmptyHint>
            <Button variant="ghost" size="sm" onClick={() => setReloadNonce((v) => v + 1)}>
              Retry
            </Button>
          </div>
        ) : state === 'error' ? (
          // Empty BECAUSE the read failed: a report with its own Retry, not an empty-state hint
          // beside a button nothing connects to the reason.
          marketsProblem && <ProblemState {...marketsProblem} />
        ) : state === 'empty' ? (
          <EmptyHint className="p-4">
            {tab === FAVOURITES_TAB.key
              ? 'No favourite markets yet — tap a star to add one.'
              : 'No matching markets.'}
          </EmptyHint>
        ) : (
          <>
            {shown.map((market) => (
              <PublicMarketRow
                key={market.symbol}
                connectionId={sourceId}
                market={market}
                favourite={favourites.has(market.symbol)}
                onOpen={openMarket}
                onToggleFavourite={toggleFav}
                embedded={embedded}
              />
            ))}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-3 text-2xs text-text-faint">
                <ActivitySignal label="Loading more" />
              </div>
            )}
            {!hasMore && capped && (
              <p className="px-3 py-2 text-2xs text-text-faint">
                Showing {rows.length} of {total} — search to reach the rest.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export const PublicMarketRow = memo(function PublicMarketRow({
  connectionId,
  market,
  favourite,
  onOpen,
  onToggleFavourite,
  embedded,
}: {
  connectionId: string
  market: Market
  favourite: boolean
  onOpen: (market: Market) => void
  onToggleFavourite: (symbol: string) => void
  embedded: boolean
}) {
  const pointerStartedOnActionRef = useRef(false)
  const resourceUri = marketResourceUri(connectionId, market.symbol)
  const menu = marketRowMenu(market, favourite, onOpen, onToggleFavourite)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          data-market-resource-uri={resourceUri}
          title={`${market.symbol} — drag to the agent input`}
          onPointerDownCapture={(event) => {
            pointerStartedOnActionRef.current = Boolean(
              (event.target as HTMLElement).closest('[data-market-row-action]'),
            )
          }}
          onPointerUpCapture={() => {
            pointerStartedOnActionRef.current = false
          }}
          onDragStart={(event) => {
            if (pointerStartedOnActionRef.current) {
              event.preventDefault()
              return
            }
            setMarketMessageBindingDrag(event.dataTransfer, connectionId, market.symbol)
          }}
          onDragEnd={() => {
            pointerStartedOnActionRef.current = false
          }}
          className="group/row flex cursor-grab select-none items-center gap-2 py-1.5 pl-3 pr-2 hover:bg-surface-hover active:cursor-grabbing"
        >
          <button
            type="button"
            onClick={() => onOpen(market)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-ring"
          >
            <CandlestickChart aria-hidden="true" className="size-3.5 shrink-0 text-text-faint" />
            <span className="flex min-w-0 flex-col">
              <span
                className={cn(
                  'truncate text-xs font-medium',
                  embedded ? 'text-foreground' : 'text-sidebar-foreground',
                )}
              >
                {market.symbol}
              </span>
              <span className="truncate text-2xs text-text-faint">{marketRowSubtitle(market)}</span>
            </span>
          </button>
          <button
            type="button"
            data-market-row-action
            aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
            title={favourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => onToggleFavourite(market.symbol)}
            className={cn(
              'shrink-0 rounded-sm p-0.5 text-text-faint outline-none transition-colors focus-visible:opacity-100 focus-ring',
              favourite
                ? 'text-status-warning'
                : 'lx-hover-actions opacity-0 group-hover/row:opacity-100 hover:text-foreground',
            )}
          >
            <Star aria-hidden="true" className={cn('size-3.5', favourite && 'fill-current')} />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
})
