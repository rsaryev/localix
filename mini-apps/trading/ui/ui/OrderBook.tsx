import { useCallback, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type { Market, PrecisionMode } from '../../backend/contracts'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import { TradingApiError, tradingApi } from '../api/tradingApi'
import { useTradingProblem } from '../problems'
import { useTradingStream } from '../model/useTradingStream'
import { buildOrderBook, type OrderBookView } from '../model/orderBookRows'
import { formatPrice, formatSize } from '../model/formatQuote'
import { sizeColumn, sizeUnit } from '../../backend/size-unit'
import { askAgent, buildBookLevelPrefill } from '../model/askAgent'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'

const VISIBLE_DEPTH = 14

/**
 * Order-book depth ladder — asks on top (reversed), a mid/spread row, then bids. Live over the
 * venue websocket when it supports it (each pushed snapshot REPLACES the ladder wholesale) and
 * polling otherwise; the two never run together. Renders its own scroll frame so it drops straight
 * into a tab. No TITLE of its own (the tab strip names it) — only a column header, which exists to
 * name the unit the size column counts in.
 *
 * A LEVEL is clickable, and the click means what it means on every trading terminal: with an
 * order ticket mounted (`onPriceSelect` — credentialed tabs) it seeds the ticket's limit price;
 * without one it hands the level to the AGENT instead — a composer prefill naming the wall plus
 * the live `orderbook` ref, so the display-only ladder is never a dead end.
 */
export function OrderBook({
  connectionId,
  symbol,
  market,
  precisionMode,
  enabled,
  onPriceSelect,
}: {
  connectionId: string
  symbol: string
  market: Market | null
  precisionMode: PrecisionMode
  enabled: boolean
  /** Seed the order ticket's limit price (mounted on credentialed tabs only). */
  onPriceSelect?: (price: number) => void
}) {
  // The chat whose composer a clicked level goes to — the tab's own; none, no question.
  const sessionId = useWorkItemSessionId()
  const [view, setView] = useState<OrderBookView | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  // A non-network failure (rate limit, venue rejecting the depth read) — swallowing it would leave
  // the panel on "Loading book…" forever. Same loading→unreachable→error ladder `marketListState`
  // documents: unreachable is quiet and outranks the message-bearing error.
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const book = await tradingApi.orderBook(connectionId, symbol, 40)
      setView(buildOrderBook(book.bids, book.asks, VISIBLE_DEPTH))
      setUnreachable(false)
      setError(null)
    } catch (err) {
      if (
        err instanceof TradingApiError &&
        (err.code === 'network_error' || err.code === 'not_connected')
      ) {
        setUnreachable(true)
      } else if (err instanceof TradingApiError) {
        // `message` is the venue-agnostic sentence the backend classified; `detail` is what the
        // venue actually said, which reads as a JSON body and belongs in the Event Center.
        acknowledgeInline(err)
        setError({ message: err.message, detail: err.detail })
      } else {
        acknowledgeInline(err)
        setError({ message: 'The depth read failed.', detail: String(err) })
      }
    }
  }, [connectionId, symbol])

  // `delivering`, not `live`. A book subscription that came up and then said nothing leaves the
  // last REST snapshot frozen on screen — and the order ticket walks that book to estimate
  // slippage. A stale book is not a still market.
  const { delivering } = useTradingStream({
    params: enabled ? { connectionId, channel: 'orderbook', symbol } : null,
    onData: (payload) => {
      if (payload.channel !== 'orderbook') return
      setView(buildOrderBook(payload.orderBook.bids, payload.orderBook.asks, VISIBLE_DEPTH))
      setUnreachable(false)
      setError(null)
    },
    onReconnect: () => void refresh(),
  })

  useVisiblePolling({
    enabled: enabled && !delivering,
    intervalMs: 2500,
    // RETURN the promise — the hook skips a scheduled tick while the previous read is still in
    // flight. `void refresh()` would hand it `undefined`, disengaging that guard and letting a slow
    // book read stack requests (the read storm this whole effort removed).
    onTick: () => refresh(),
    immediate: true,
    resetKey: `${connectionId}/${symbol}/${String(delivering)}`,
  })

  // What a level click DOES (named once, so the row's tooltip and the handler agree).
  const levelAction = onPriceSelect ? ('seed' as const) : ('ask' as const)
  const selectLevel = (price: number, side: 'bid' | 'ask') => {
    if (onPriceSelect) {
      onPriceSelect(price)
      return
    }
    // The prefill carries the figures AS RENDERED plus the live orderbook ref — same words on
    // screen and in chat.
    if (!sessionId) return
    const level = (side === 'bid' ? view?.bids : view?.asks)?.find((r) => r.price === price)
    askAgent(
      sessionId,
      buildBookLevelPrefill(
        { connectionId, symbol },
        {
          side,
          price: formatPrice(price, market, precisionMode),
          size: level ? formatSize(level.amount, market, precisionMode) : undefined,
          sizeUnit: sizeUnit(market).label || undefined,
        },
      ),
    )
  }

  // Published above the early returns so the row settles when the venue answers again, rather than
  // when the branch that drew it stops rendering. A book with rows is stale, not dead.
  const hasView = view !== null
  const problem = useTradingProblem({
    subject: `${symbol} book`,
    failure:
      unreachable || error
        ? (error ?? { message: 'The venue stopped answering the depth read.' })
        : null,
    // No hand-written title: `stale` already renders "showing the last valid version", so spelling
    // it out again put the same fact on the line twice.
    consequence: hasView ? 'stale' : 'blocked',
  })

  if (!enabled)
    return (
      <BookScroll>
        {<EmptyHint className="text-2xs">Order book unavailable on this venue.</EmptyHint>}
      </BookScroll>
    )
  if (problem && !view)
    return (
      <BookScroll>
        <ProblemLine {...problem} className="px-2 py-1" />
      </BookScroll>
    )
  if (!view)
    return <BookScroll>{<LoadingHint className="text-2xs">Loading book…</LoadingHint>}</BookScroll>

  return (
    <BookScroll>
      {/* The venue went down AFTER a good snapshot: keep the ladder (the rows are real, just from
          a moment ago) but say so — a stale book is not a still market. */}
      {problem && <ProblemLine {...problem} className="px-2 py-1" />}
      {/* Depth is counted in the VENUE's unit — contracts on a contract market. Two unlabelled
          columns of numbers let a trader read a size as an amount of the asset; the header names
          the unit once. An unreadable market names none rather than the wrong one.
          Occluding, like every other sticky header: the ladder scrolls UNDER this row, and at the
          /20 fill it used to carry, price and size read straight through the labels. Pane-hue,
          the shared `lx-occluder` recipe, not a hand-written fill: a coat of the pane's own
          ground composites denser than the pane under glass and read as an abrupt black bar. */}
      <div className="lx-occluder sticky top-0 z-(--z-sticky) flex items-center justify-between border-b border-border-soft px-2 py-1 text-2xs uppercase tracking-wide text-text-faint">
        <span>Price{market?.quote ? ` (${market.quote})` : ''}</span>
        <span>{sizeColumn('Size', market)}</span>
      </div>
      <div className="flex flex-col-reverse">
        {view.asks.map((r) => (
          <DepthRow
            key={`a${r.price}`}
            price={formatPrice(r.price, market, precisionMode)}
            amount={formatSize(r.amount, market, precisionMode)}
            ratio={r.ratio}
            side="ask"
            onSelect={() => selectLevel(r.price, 'ask')}
            action={levelAction}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 items-center gap-1 border-y border-border-soft bg-surface-raised/80 px-2 py-1.5 text-2xs tabular-nums">
        <span className="font-medium text-text-soft">Spread</span>
        <span className="text-center text-foreground">
          {view.spread != null ? formatPrice(view.spread, market, precisionMode) : '—'}
        </span>
        <span className="text-right text-text-faint">
          {view.spreadBps != null ? `${(view.spreadBps / 100).toFixed(3)}%` : '—'}
        </span>
      </div>
      {/* Buy/sell-pressure bar: the share of visible depth resting on each side. Green = bids (buy
          interest), red = asks. The exact split is labelled beside it (not just a hover tooltip) so
          the imbalance reads at a glance. Hidden when neither side has size, never a fabricated 50/50. */}
      {view.bidShare != null && (
        <div
          className="flex flex-col gap-0.5"
          title={`${Math.round(view.bidShare * 100)}% bids / ${Math.round((1 - view.bidShare) * 100)}% asks (visible depth)`}
        >
          <div className="flex items-center justify-between px-2 text-2xs tabular-nums">
            <span className="text-status-success">{Math.round(view.bidShare * 100)}% bids</span>
            <span className="text-status-error">{Math.round((1 - view.bidShare) * 100)}% asks</span>
          </div>
          <div className="flex h-0.5 w-full overflow-hidden">
            <span className="bg-status-success" style={{ width: `${view.bidShare * 100}%` }} />
            <span className="bg-status-error" style={{ width: `${(1 - view.bidShare) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="flex flex-col">
        {view.bids.map((r) => (
          <DepthRow
            key={`b${r.price}`}
            price={formatPrice(r.price, market, precisionMode)}
            amount={formatSize(r.amount, market, precisionMode)}
            ratio={r.ratio}
            side="bid"
            onSelect={() => selectLevel(r.price, 'bid')}
            action={levelAction}
          />
        ))}
      </div>
    </BookScroll>
  )
}

function BookScroll({ children }: { children: React.ReactNode }) {
  return <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
}

function DepthRow({
  price,
  amount,
  ratio,
  side,
  onSelect,
  action,
}: {
  price: string
  amount: string
  ratio: number
  side: 'bid' | 'ask'
  onSelect: () => void
  /** What the click does — seeds the ticket's limit price, or asks the agent about the level. */
  action: 'seed' | 'ask'
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={
        action === 'seed'
          ? `Set limit price ${price}`
          : `Ask the agent about the ${side} at ${price}`
      }
      className="relative flex w-full items-center justify-between px-2 py-1.5 text-left text-2xs tabular-nums outline-none transition-colors hover:bg-surface-hover/60 focus-ring"
    >
      <span
        className={cn(
          'absolute inset-y-0 right-0',
          side === 'bid' ? 'bg-status-success/10' : 'bg-status-error/10',
        )}
        style={{ width: `${Math.round(ratio * 100)}%` }}
        aria-hidden
      />
      <span
        className={cn(
          'relative z-(--z-raised)',
          side === 'bid' ? 'text-status-success' : 'text-status-error',
        )}
      >
        {price}
      </span>
      <span className="relative z-(--z-raised) text-text-soft">{amount}</span>
    </button>
  )
}
