import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { ExchangeInfo, Market, PrecisionMode } from '../backend/contracts'
import { useTheme } from '@localixai/kit/theme'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { ProblemLine } from '@localixai/plugin-sdk/ui/components'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import { useElementVisible } from '@localixai/plugin-sdk/ui/visibility'
import { TradingApiError, tradingApi } from './api/tradingApi'
import { useTradingProblem, type TradingFailure } from './problems'
import { useOhlcv } from './model/useOhlcv'
import { useTicker } from './model/useTicker'
import { summarizeMarket } from './model/quoteSummary'
import { useContractStats } from './model/useContractStats'
import { ChartHeader } from './ui/ChartHeader'
import { TimeframeBar } from './ui/TimeframeBar'
import { ChartCanvas } from './ui/ChartCanvas'
import { openTradingChartTab, tradingChartTabId } from './model/openTab'
import { chartControlBus } from './model/chartControlBus'
import { chartStateStore } from './model/chartStateStore'
import { MarketSidePanel } from './ui/MarketSidePanel'
import { chartPriceFormat } from './model/formatQuote'
import {
  PREFERRED_TIMEFRAMES,
  loadTimeframe,
  pickTimeframe,
  saveTimeframe,
} from './model/timeframePref'
import { acknowledgeInline, type PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { chartMessageContext } from './model/chartMessageContext'
import { DEFAULT_TIMEFRAME } from '../backend/timeframes'

/** Global (not per-market) preference: is the right-hand order-book / ticket column collapsed. */
const SIDE_PANEL_COLLAPSED_KEY = 'localix.trading.sidePanelCollapsed'

/**
 * The `trading-chart` WorkItem — a LAYOUT: a live quote header, the candlestick canvas, and a
 * right-hand column carrying the order book and the trade tape.
 *
 * READ-ONLY by construction. This workbench charts and analyses public market data; it holds no
 * credentials, reads no account, and places no orders. There is nothing here for an exchange key
 * to unlock, which is what makes the surface safe to point at any venue.
 */
export function TradingChartTab({
  sessionId,
  connectionId,
  symbol,
  exchangeId,
  name,
  connectionName,
  credentialed,
  active = true,
  publishMessageContext,
}: {
  /** The chat this chart belongs to — where a switched market opens and its questions go. */
  sessionId: string
  connectionId: string
  symbol: string
  exchangeId?: string
  /** Tab title; the tab strip renders it, this component does not. */
  name?: string
  connectionName?: string
  /** The opener's credentialed claim, republished so this chat's titlebar reopens it faithfully. */
  credentialed?: boolean
  /** False while the tab is warm-hidden — every live read parks. */
  active?: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const { resolvedTheme } = useTheme()
  // Warm keep-alive awareness: the grid keeps this body mounted (display:none) after a tab
  // switch. While hidden, every live data hook below pauses; the caches repaint on re-show.
  const [tabRootRef, tabVisible] = useElementVisible<HTMLDivElement>()
  const dataActive = active && tabVisible
  const [describe, setDescribe] = useState<ExchangeInfo | null>(null)
  const [market, setMarket] = useState<Market | null>(null)
  const [describeError, setDescribeError] = useState<TradingFailure | null>(null)

  // The order-book / ticket column collapses to a thin rail — a global preference (how a trader
  // wants the workspace laid out is the same on every market), persisted so it survives a reload.
  // OPEN by default: the book is half of what a market screen is for, and a rail labelled
  // "Order book" is a thing to discover rather than a thing to read. Absent stored value → open;
  // an explicit `true` keeps it collapsed for whoever chose that.
  const [panelCollapsed, setPanelCollapsed] = useState(
    () => loadJSON<boolean>(SIDE_PANEL_COLLAPSED_KEY) === true,
  )
  const togglePanel = useCallback(() => {
    setPanelCollapsed((prev) => {
      const next = !prev
      saveJSON(SIDE_PANEL_COLLAPSED_KEY, next)
      return next
    })
  }, [])
  // Seed from the remembered preference SYNCHRONOUSLY so the very first history request is already
  // the right horizon — waiting for `describe` to pick it re-fetched the whole seed window whenever
  // the remembered timeframe was not the default. `describe` then only VALIDATES it (below): a
  // remembered timeframe the venue no longer offers is replaced, which is the rare case.
  const [timeframe, setTimeframe] = useState(() => loadTimeframe(connectionId) ?? DEFAULT_TIMEFRAME)

  // A timeframe change is a preference, not a transient: it is what this connection's charts open
  // on next time, here and in every other market. Persisted eagerly so a reload cannot lose it.
  const chooseTimeframe = useCallback(
    (tf: string) => {
      setTimeframe(tf)
      saveTimeframe(connectionId, tf)
    },
    [connectionId],
  )

  const precisionMode: PrecisionMode = describe?.precisionMode ?? 'tick'

  // Agent `manage_chart` commands for THIS chart (keyed by the tab-id formula the sink uses).
  // The tab handles set_timeframe — it owns that state; ChartCanvas subscribes under the same
  // key for indicators / chart type / navigation. The venue's offered list is read through a ref
  // so the subscription survives `describe` landing.
  const controlKey = tradingChartTabId(connectionId, symbol)

  // Stable identity — ChartCanvas is memo'd and this tab re-renders on every ticker push.
  const analysisMarket = useMemo(
    () => ({ connectionId, symbol, timeframe }),
    [connectionId, symbol, timeframe],
  )
  // The snapshot read-back's source of truth: this tab owns identity + mounted +
  // timeframe in the chart-state store; ChartCanvas publishes the rest under the
  // same key. Unmount keeps the entry as last-known state (mounted: false). Both live
  // channels are addressed by THIS chat as well as the market — another chat's chart of the
  // same market is a different chart.
  useEffect(() => {
    chartStateStore.patch(sessionId, controlKey, {
      mounted: true,
      market: { connectionId, symbol, exchangeId, name, connectionName, credentialed },
    })
    return () => chartStateStore.markUnmounted(sessionId, controlKey)
  }, [sessionId, controlKey, connectionId, symbol, exchangeId, name, connectionName, credentialed])
  useEffect(() => {
    chartStateStore.patch(sessionId, controlKey, { timeframe })
  }, [sessionId, controlKey, timeframe])
  useEffect(() => {
    if (!publishMessageContext) return
    publishMessageContext(chartMessageContext(connectionId, symbol, timeframe))
  }, [connectionId, publishMessageContext, symbol, timeframe])
  const offeredRef = useRef<readonly string[]>([])
  offeredRef.current = describe?.timeframes ?? []
  useEffect(() => {
    return chartControlBus.subscribe(sessionId, controlKey, (command) => {
      if (command.type !== 'set_timeframe') return
      const offered = offeredRef.current
      // Only a timeframe the venue actually offers — a chart cannot be drawn on a bar size the
      // exchange does not produce. Before `describe` lands the list is empty: trust the command
      // (the schema already shape-checked it) and let the venue's own error surface if wrong.
      if (offered.length > 0 && !offered.includes(command.timeframe)) return
      chooseTimeframe(command.timeframe)
    })
  }, [sessionId, controlKey, chooseTimeframe])

  // Load the exchange capabilities/timeframes + this market's precision once.
  useEffect(() => {
    if (!dataActive) return
    let cancelled = false
    void (async () => {
      try {
        const info = await tradingApi.describe(connectionId)
        if (cancelled) return
        setDescribe(info)
        setDescribeError(null)
        // The remembered timeframe when the venue still offers it, else a sensible default it does.
        setTimeframe(pickTimeframe(loadTimeframe(connectionId), info.timeframes))
      } catch (err) {
        if (!cancelled) {
          acknowledgeInline(err)
          const quiet =
            err instanceof TradingApiError &&
            (err.code === 'network_error' || err.code === 'not_connected')
          setDescribeError(
            quiet
              ? { message: 'The venue is unreachable — try again shortly.' }
              : err instanceof TradingApiError
                ? { message: err.message, detail: err.detail }
                : {
                    message: 'This exchange could not be read.',
                    detail: err instanceof Error ? err.message : String(err),
                  },
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connectionId, dataActive])

  useEffect(() => {
    if (!dataActive) return
    let cancelled = false
    void (async () => {
      const list = await tradingApi
        .markets(connectionId, { query: symbol, limit: 50 })
        .catch(() => [] as Market[])
      if (!cancelled) setMarket(list.find((m) => m.symbol === symbol) ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [connectionId, symbol, dataActive])

  // The chart canvas mounts immediately, but its loading state is rendered as a structural overlay so
  // the user sees the workspace shape before the history arrives — never a blank pane or a misleading
  // two-bar chart.
  const { candles, loading, unreachable, error, loadOlder } = useOhlcv(
    connectionId,
    symbol,
    timeframe,
    // Paused while this tab is warm-hidden (the grid keeps recent bodies mounted) — no tail
    // polls, no stream subscription. The candle cache repaints + revalidates on re-show.
    { enabled: dataActive },
  )
  // The exchange's capabilities are already loaded here; the ticker hook needs one field out of them
  // and must NOT re-fetch them. `undefined` until they land (or if they failed) keeps its expensive
  // REST fallback parked rather than guessing the read is cheap.
  const ticker = useTicker(connectionId, symbol, {
    enabled: dataActive,
    emulated: describe ? describe.capabilities.ticker === 'emulated' : undefined,
  })
  const summary = useMemo(() => summarizeMarket(ticker.ticker, candles), [ticker.ticker, candles])
  // A perpetual's carry cost and outstanding size. Spot answers null and the chips stay hidden.
  //
  // Held back until the history has SETTLED, because the venue's rate limiter is a single serial
  // queue and this read is the most expensive thing the tab asks for: Hyperliquid prices
  // `metaAndAssetCtxs` at cost 20 — a full second of throttle sleep — against the candles' cost 4.
  // Fired together, whichever reaches the limiter first drains the bucket, and it is usually this
  // one (it posts immediately, while `fetchOHLCV` first awaits its market table). Measured on
  // `XYZ-SP500/USDC:USDC`: candles alone 2050ms, candles racing the stats read 2976ms. Funding and
  // open interest are slow-moving figures polled once a minute; the chart is what the user opened.
  //
  // The gate LATCHES per market: a timeframe switch empties the candle array on its way to the new
  // history, and re-closing the gate there would re-fire the second-long stats read on every click
  // of the timeframe bar. Funding does not depend on the bar size.
  // Owned above the branches: the arm that draws it disappears the moment candles arrive, and an
  // owner that disappears never settles the row it published. The exchange read outranks the candle
  // read — without the exchange there is no chart to be missing candles from.
  const chartProblem = useTradingProblem({
    subject: `${symbol} chart`,
    failure: describeError ?? (candles.length === 0 ? error : null),
  })

  const [historySettled, setHistorySettled] = useState(false)
  useEffect(() => setHistorySettled(false), [connectionId, symbol])
  useEffect(() => {
    if (candles.length > 0 || error !== null || unreachable) setHistorySettled(true)
  }, [candles.length, error, unreachable])
  const { funding, openInterest } = useContractStats(connectionId, symbol, {
    enabled: historySettled && dataActive,
    // The venue's own claims: a read it reports as unsupported is never round-tripped to its
    // `not_supported` error (Coinbase International reports no open interest, e.g.).
    funding: describe ? describe.capabilities.fundingRate !== 'none' : undefined,
    openInterest: describe?.capabilities.openInterest,
  })

  // Derived from the CLOSED candles' closes, not the live bar: the in-progress close IS the last
  // trade, and a price oscillating between `63982` and `63982.5` would flip the axis between 0 and
  // 1 decimals on every tick. The lone first bar of a fresh market is used as-is.
  const closes = useMemo(
    () => (candles.length > 1 ? candles.slice(0, -1) : candles).map((c) => c.close),
    [candles],
  )
  const priceFormat = useMemo(
    () => chartPriceFormat(market, precisionMode, closes),
    [market, precisionMode, closes],
  )

  const timeframes = describe?.timeframes ?? []

  // No ground coat on the tab root, its body row, or the chart column below: the hosting pane
  // already paints one, and under the host's macOS glass theme the ground tokens carry alpha — a
  // second pane-sized coat compounds into an opaque slab, and three nested coats went black.
  return (
    <div ref={tabRootRef} className="flex h-full min-h-0 flex-col">
      <ChartHeader
        symbol={symbol}
        connectionId={connectionId}
        venue={connectionName ?? exchangeId ?? connectionId}
        summary={summary}
        market={market}
        precisionMode={precisionMode}
        funding={funding}
        openInterest={openInterest}
        // Switching market opens/focuses that market's chart tab in THIS connection, carrying the
        // same connection context a sidebar click would.
        onSelectMarket={(m) =>
          openTradingChartTab(sessionId, {
            connectionId,
            symbol: m.symbol,
            exchangeId,
            name: `${m.symbol} · ${connectionName ?? exchangeId ?? connectionId}`,
            connectionName,
          })
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col">
          <TimeframeBar
            timeframes={timeframes}
            preferred={PREFERRED_TIMEFRAMES}
            timeframe={timeframe}
            onTimeframe={chooseTimeframe}
          />
          <div className="relative min-h-0 flex-1" aria-busy={loading}>
            {describeError || (error && candles.length === 0) ? (
              // Empty BECAUSE the read failed. An `EmptyHint` said so in grey text that nothing
              // durable ever saw — and a market you are not watching is the one whose failure you
              // need to read afterwards.
              <ChartPlaceholder>
                {chartProblem && <ProblemLine {...chartProblem} />}
              </ChartPlaceholder>
            ) : unreachable && candles.length === 0 ? (
              <ChartPlaceholder>
                <EmptyHint>The venue is unreachable — the chart will resume shortly.</EmptyHint>
              </ChartPlaceholder>
            ) : (
              <ChartCanvas
                candles={candles}
                theme={resolvedTheme}
                priceFormat={priceFormat}
                onLoadOlder={() => void loadOlder()}
                loading={loading}
                controlKey={controlKey}
                controlSessionId={sessionId}
                analysisMarket={analysisMarket}
              />
            )}
          </div>
        </main>
        {panelCollapsed ? (
          // Collapsed: a thin rail that IS the affordance — the whole strip expands, not a
          // 6×6 icon inside it.
          <button
            type="button"
            onClick={togglePanel}
            title="Show order book"
            aria-label="Show order book"
            aria-expanded={false}
            className="flex w-8 shrink-0 cursor-pointer flex-col items-center border-l border-border-soft pt-2 outline-none transition-colors hover:bg-surface-hover/40 focus-ring"
          >
            <PanelRightOpen className="size-4 text-text-faint" aria-hidden />
            <span
              className="mt-2 select-none text-2xs uppercase tracking-wider text-text-faint"
              style={{ writingMode: 'vertical-rl' }}
            >
              Order book
            </span>
          </button>
        ) : (
          <section
            aria-label="Order book"
            className="flex w-[clamp(14rem,23vw,17rem)] min-w-0 shrink-0 flex-col border-l border-border-soft"
          >
            {/* The whole header collapses the column — same reasoning as the rail. */}
            <button
              type="button"
              onClick={togglePanel}
              title="Collapse panel"
              aria-label="Collapse panel"
              aria-expanded={true}
              className="flex h-[var(--chrome-control-md)] shrink-0 cursor-pointer items-center justify-end border-b border-border-soft px-1.5 text-text-faint outline-none transition-colors hover:bg-surface-hover/40 hover:text-foreground focus-ring"
            >
              <PanelRightClose className="size-3.5" aria-hidden />
            </button>
            {/* TRADE is a tab of this column now, not a form stacked on top of the ladder.
                Credentialed: the real ticket. Public: the ticket's shape, blurred, with the way
                in — the trading half of the workbench used to be simply absent here, which
                taught a user with an API key that it did not exist. */}
            <MarketSidePanel
              connectionId={connectionId}
              symbol={symbol}
              market={market}
              precisionMode={precisionMode}
              bookEnabled={describe?.capabilities.orderBook ?? false}
            />
          </section>
        )}
      </div>
    </div>
  )
}

/** Anything shown INSTEAD of the chart sits dead-centre in the chart's box, horizontally and
 *  vertically — the canvas fills that box, so a message pinned to its corner reads as a stray
 *  label rather than the chart's state. */
function ChartPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-full select-none flex-col items-center justify-center p-4 text-center">
      {children}
    </div>
  )
}
