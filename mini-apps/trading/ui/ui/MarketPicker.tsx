import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickChart, Star } from 'lucide-react'
import type { Market } from '../../backend/contracts'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { Kbd } from '@localixai/kit/kbd'
import { MatchedText } from '@localixai/kit/matched-text'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  useCommandState,
} from '@localixai/kit/command'
import { useMarkets } from '../model/useMarkets'
import { marketListState } from '../model/marketListState'
import { useMarketPrices } from '../model/useMarketPrices'
import { loadFavourites, toggleFavourite } from '../model/favourites'
import { FAVOURITES_TAB, filterMarketRows } from '../model/marketPicker'
import { useMarketTabs } from '../model/useMarketTabs'
import { MarketTabStrip } from './MarketTabStrip'
import {
  marketDexBadge,
  marketInactiveBadge,
  marketLeverageBadge,
  marketRowSubtitle,
} from '../model/marketBadges'
import { marketRowQuote, type MarketRowQuote } from '../model/marketRowQuote'

interface MarketPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  /** The market currently on the chart — highlighted so the switcher opens on it. */
  currentSymbol: string
  /** Selecting a row opens/focuses that market's chart tab. */
  onSelect: (market: Market) => void
}

/**
 * The chart-header MARKET SWITCHER (Hyperliquid-style), opened from the symbol button.
 *
 * A searchable `cmdk` palette — the SAME shell as the global-search palette, so ↑/↓ move, Enter
 * opens, Esc closes for free, and `type` filters. Above the list sits a category tab bar (All /
 * Favourites / a tab per market type the venue actually reports); ⇥ / ⇧⇥ cycle the tabs. `⌘S`
 * stars the highlighted row, sharing the sidebar's favourites store.
 *
 * The market roster is loaded through `useMarkets` (server-side, debounced query) — the loaded page
 * is a fair per-type cap, not the whole venue, so the query is sent to the server rather than only
 * filtered locally. Searching `AAPL` therefore finds every venue market whose symbol/base/quote
 * contains it (`AAPL/USDC`, `XYZ-AAPL/USDC:USDC`, …), because `base` carries the dex prefix.
 *
 * A row shows the symbol, its pair and type, the dex-prefix badge (so `AAPL` and `XYZ-AAPL` never
 * look identical) and the venue's leverage cap. It ALSO shows a LAST PRICE, the traded VOLUME with
 * the unit it is counted in, and — where the venue reports the 24h datum — a 24h change.
 * `useMarketPrices` reads the quotes for exactly the rows on
 * screen — the ranked/capped/filtered page — through ONE cheap scoped venue read per market type
 * (`tradingApi.marketTickers`), never the ~13s / 12-request bulk fan-out a per-row `fetchTicker`
 * would cost. Rows render INSTANTLY without prices and fill in when the read lands. A market the
 * cheap read cannot price (unknown, or a builder/HIP-3 market) shows NO price — never a `0`, a `—`
 * dressed as a price, or another market's number: a claim the venue never made is not made.
 */
export function MarketPicker({
  open,
  onOpenChange,
  connectionId,
  currentSymbol,
  onSelect,
}: MarketPickerProps) {
  const [query, setQuery] = useState('')
  const [favVersion, setFavVersion] = useState(0)

  const markets = useMarkets(connectionId, open, query)
  const favourites = useMemo(
    () => loadFavourites(connectionId),
    // favVersion re-reads after a toggle; re-read on (re)open too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionId, favVersion, open],
  )

  // Reset each time the picker opens so a stale query / tab never flashes (mirrors the global
  // palette); the tabs reset with it (`resetKey`) and derive from the roster while open.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])
  const { tab, setTab, tabs, cycleTab } = useMarketTabs({
    markets: markets.markets,
    query,
    resetKey: open,
    enabled: open,
  })

  const { rows, total, capped } = useMemo(
    () => filterMarketRows(markets.markets, { query, tab, favourites }),
    [markets.markets, query, tab, favourites],
  )

  // Prices for exactly the rows on screen (the capped/filtered page), fetched cheaply and filled in
  // when they land. Keyed by symbol, so a value is only ever shown against the market it belongs to.
  const rowSymbols = useMemo(() => rows.map((m) => m.symbol), [rows])
  const prices = useMarketPrices(connectionId, rowSymbols, open)

  // Map a cmdk-normalised (lower-cased) selected value back to the real symbol for ⌘S.
  const rowByValue = useMemo(() => {
    const map = new Map<string, Market>()
    for (const m of rows) map.set(m.symbol.toLowerCase(), m)
    return map
  }, [rows])
  const listState = marketListState(markets, rows.length)
  const selectedRef = useRef<string | null>(null)

  const toggle = useCallback(
    (symbol: string) => {
      toggleFavourite(connectionId, symbol)
      setFavVersion((v) => v + 1)
    },
    [connectionId],
  )

  const pick = useCallback(
    (m: Market) => {
      onOpenChange(false)
      onSelect(m)
    },
    [onOpenChange, onSelect],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const value = selectedRef.current
        const m = value ? rowByValue.get(value) : undefined
        if (m) toggle(m.symbol)
      }
    },
    [cycleTab, rowByValue, toggle],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Switch market"
      description="Search this venue's markets"
    >
      {/* `@container`: the volume column below yields on the DIALOG's width, not the window's —
          a viewport `sm:` read a narrow dialog on a wide screen as roomy. */}
      <Command shouldFilter={false} onKeyDown={onKeyDown} className="@container">
        <SelectionTracker onValue={(v) => (selectedRef.current = v)} />
        <CommandInput placeholder="Search markets…" value={query} onValueChange={setQuery} />

        {/* Category tabs — derived from the roster, cycled with ⇥ / ⇧⇥ from the search field.
            A dialog, not the sidebar: the default tone, not the sidebar accent it used to borrow. */}
        <MarketTabStrip tabs={tabs} active={tab} onChange={setTab} />

        <CommandList>
          {listState === 'loading' ? (
            <CommandEmpty>
              <ActivitySignal label="Loading markets" className="justify-center" />
            </CommandEmpty>
          ) : listState === 'unreachable' ? (
            <CommandEmpty>The venue is unreachable — try again shortly.</CommandEmpty>
          ) : listState === 'error' ? (
            <CommandEmpty>{markets.error?.message}</CommandEmpty>
          ) : listState === 'empty' ? (
            <CommandEmpty>
              {tab === FAVOURITES_TAB.key
                ? 'No favourite markets yet — press ⌘S on a row to star it.'
                : 'No matching markets.'}
            </CommandEmpty>
          ) : (
            <CommandGroup
              heading={
                capped
                  ? `Showing ${rows.length} of ${total} — refine the search to see more`
                  : undefined
              }
            >
              {rows.map((m) => (
                <MarketPickerRow
                  key={m.symbol}
                  market={m}
                  query={query.trim()}
                  quote={marketRowQuote(prices.get(m.symbol), m)}
                  favourite={favourites.has(m.symbol)}
                  current={m.symbol === currentSymbol}
                  onSelect={() => pick(m)}
                  onToggleFav={() => toggle(m.symbol)}
                />
              ))}
            </CommandGroup>
          )}
        </CommandList>

        {/* `variant="filled"` rather than a `bg-surface-raised` override: the Kbd primitive owns
            the keycap fill as a foreground veil, where the raised ground token mixes from a
            darker ground than this palette and made every keycap a black square. */}
        <div className="flex items-center gap-3 border-t border-border-soft px-3 py-1.5 text-2xs text-text-faint">
          <span className="inline-flex items-center gap-1">
            <Kbd variant="filled" className="text-3xs text-text-soft">
              ↑↓
            </Kbd>{' '}
            Navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd variant="filled" className="text-3xs text-text-soft">
              ↵
            </Kbd>{' '}
            Open
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd variant="filled" className="text-3xs text-text-soft">
              ⇥
            </Kbd>{' '}
            Category
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Kbd variant="filled" className="text-3xs text-text-soft">
              ⌘S
            </Kbd>{' '}
            Favourite
          </span>
        </div>
      </Command>
    </CommandDialog>
  )
}

/** Bridges cmdk's selected value out to a ref so the ⌘S handler knows the highlighted row. */
function SelectionTracker({ onValue }: { onValue: (v: string | null) => void }) {
  const value = useCommandState((s) => s.value)
  useEffect(() => {
    onValue(value || null)
  }, [value, onValue])
  return null
}

function MarketPickerRow({
  market,
  query,
  quote,
  favourite,
  current,
  onSelect,
  onToggleFav,
}: {
  market: Market
  query: string
  /** The row's price + optional 24h change, or `null` when the venue gave no price this page. */
  quote: MarketRowQuote | null
  favourite: boolean
  current: boolean
  onSelect: () => void
  onToggleFav: () => void
}) {
  const dex = marketDexBadge(market)
  const leverage = marketLeverageBadge(market)
  const inactive = marketInactiveBadge(market)
  return (
    <CommandItem value={market.symbol} onSelect={onSelect} className="group/row gap-2">
      <CandlestickChart className="size-4 shrink-0 text-text-faint" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <MatchedText text={market.symbol} query={query} />
          {/* The dex prefix disambiguates otherwise-similar tickers (AAPL vs XYZ-AAPL). */}
          {dex && (
            // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than the
            // picker's frosted panel, so these row badges read as black tags. Their `status-*`
            // siblings below are already tints of their own colour.
            <span className="shrink-0 rounded-sm bg-foreground/[0.06] px-1 text-3xs font-medium lowercase text-text-soft">
              {dex}
            </span>
          )}
          {/* The venue's leverage CAP for this market — not the user's leverage. */}
          {leverage && (
            <span
              // Same veil as the dex badge above, not the darker-ground `bg-surface-raised`.
              className="shrink-0 rounded-sm bg-foreground/[0.06] px-1 text-3xs text-text-faint"
              title="Venue max leverage"
            >
              {leverage}
            </span>
          )}
          {/* Delisted / halted — a dead market must not read as an active source. */}
          {inactive && (
            <span
              className="shrink-0 rounded-sm bg-status-warning/15 px-1 text-3xs uppercase tracking-wide text-status-warning"
              title="Delisted or halted — data may be historical"
            >
              {inactive}
            </span>
          )}
          {current && (
            // Same veil as the badges above, not the darker-ground `bg-surface-raised`.
            <span className="shrink-0 rounded-sm bg-foreground/[0.06] px-1 text-3xs uppercase tracking-wide text-text-faint">
              Current
            </span>
          )}
        </span>
        <span className="truncate text-2xs text-text-faint">{marketRowSubtitle(market)}</span>
      </span>
      {/* Price + 24h change — right-aligned, tabular so digits align down the column. Rendered only
          when the venue actually priced this row; an unpriced row keeps this cell empty. */}
      {quote?.volume && (
        <span
          className="hidden shrink-0 flex-col items-end text-2xs tabular-nums text-text-faint @sm:flex"
          title={`Traded volume, counted in ${quote.volume.unit}`}
        >
          <span>{quote.volume.text}</span>
          <span className="text-3xs uppercase tracking-wide">{quote.volume.unit}</span>
        </span>
      )}
      {quote && (
        <span className="flex shrink-0 flex-col items-end text-2xs tabular-nums">
          <span className="text-foreground">{quote.price}</span>
          {quote.change && (
            <span
              className={cn(
                quote.change.sign > 0
                  ? 'text-status-success'
                  : quote.change.sign < 0
                    ? 'text-status-error'
                    : 'text-text-soft',
              )}
            >
              {quote.change.text}
            </span>
          )}
        </span>
      )}
      {/* Star toggle. stopPropagation so starring never selects/opens the row. */}
      <button
        type="button"
        aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
        title={favourite ? 'Remove from favourites (⌘S)' : 'Add to favourites (⌘S)'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onToggleFav()
        }}
        className={cn(
          'shrink-0 rounded-sm p-0.5 outline-none transition-colors focus-visible:opacity-100 focus-ring',
          favourite
            ? 'text-status-warning'
            : 'lx-hover-actions text-text-faint opacity-0 group-hover/row:opacity-100 hover:text-foreground',
        )}
      >
        <Star className={cn('size-3.5', favourite && 'fill-current')} />
      </button>
    </CommandItem>
  )
}
