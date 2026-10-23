import { useEffect, useState } from 'react'
import type { Market, PrecisionMode, PublicTrade } from '../../backend/contracts'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useTradingStream } from '../model/useTradingStream'
import { reconcileTrades } from '../model/streamReconcile'
import { formatPrice, formatSize } from '../model/formatQuote'
import { tradeTimeLabel } from '../model/timeLabels'
import { sizeColumn, sizeUnit } from '../../backend/size-unit'
import { askAgent, buildTapePrintPrefill } from '../model/askAgent'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { tradeFlow } from '../model/tradeFlow'

/**
 * Recent-trades tape. There is no reliable PUBLIC REST trade tape on some venues
 * (Hyperliquid's `fetchTrades` needs a wallet and returns the caller's own fills), so this
 * is fed ONLY by the venue websocket `trades` stream — prepended, de-duplicated and bounded.
 * When the venue has no `pro` driver the stream simply never goes live, so the tape renders
 * its QUIET empty state — never an error toast. Renders its own scroll frame so it drops into a tab.
 *
 * A PRINT is clickable: it hands the agent the print as rendered plus the live `trades` ref
 * (composer prefill, `askAgent` pattern) — the tape is a surface to reason from, not a
 * display-only dead end.
 */
export function TradesTape({
  connectionId,
  symbol,
  market,
  precisionMode,
}: {
  connectionId: string
  symbol: string
  market: Market | null
  precisionMode: PrecisionMode
}) {
  // The chat whose composer a clicked print goes to — the tab's own; none, no question.
  const sessionId = useWorkItemSessionId()
  const [trades, setTrades] = useState<PublicTrade[]>([])
  // Grace window: while the websocket is still coming up, "needs a market-data stream" would read
  // as a capability claim — and then contradict itself when the first prints arrive.
  const [settling, setSettling] = useState(true)
  const enabled = !!connectionId && !!symbol

  // Reset the tape when the target market changes (a fresh feed, not a merge across symbols).
  useEffect(() => {
    setTrades([])
    setSettling(true)
    const timer = setTimeout(() => setSettling(false), 5000)
    return () => clearTimeout(timer)
  }, [connectionId, symbol])

  const { delivering } = useTradingStream({
    params: enabled ? { connectionId, channel: 'trades', symbol } : null,
    onData: (payload) => {
      if (payload.channel !== 'trades') return
      setTrades((prev) => reconcileTrades(prev, payload.trades))
    },
  })

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      {trades.length === 0 ? (
        delivering || settling ? (
          <LoadingHint className="text-2xs">Waiting for trades…</LoadingHint>
        ) : (
          <EmptyHint className="text-2xs">Live trade tape needs a market-data stream.</EmptyHint>
        )
      ) : (
        <>
          {/* Each print's size is in the VENUE's unit — contracts on a contract market. Named once
            here rather than repeated on every row; an unreadable market names no unit at all.
            The shared `lx-occluder` recipe, not a hand-written fill: a coat of the pane's own
            ground composites denser than the pane under glass and read as an abrupt black bar. */}
          <div className="lx-occluder sticky top-0 z-(--z-sticky) flex flex-col gap-0.5 border-b border-border-soft px-2 py-1">
            <div className="flex items-center justify-between gap-2 text-2xs uppercase tracking-wide text-text-faint">
              <span>Price{market?.quote ? ` (${market.quote})` : ''}</span>
              <span className="ml-auto">{sizeColumn('Size', market)}</span>
              <span className="w-16 text-right">Time</span>
            </div>
            {/* Aggressor imbalance over the loaded prints: how much executed volume lifted the ask
                (buy) vs hit the bid (sell) — real, traded pressure, not resting depth. */}
            {(() => {
              const flow = tradeFlow(trades)
              if (!flow) return null
              const buyPct = Math.round(flow.buyShare * 100)
              return (
                <div
                  className="flex flex-col gap-0.5"
                  title={`${buyPct}% of the last ${trades.length} prints' volume was buy-side (lifted the ask)`}
                >
                  <div className="flex items-center justify-between text-2xs tabular-nums">
                    <span className="text-status-success">{buyPct}% buy</span>
                    <span className="text-status-error">{100 - buyPct}% sell</span>
                  </div>
                  <div className="flex h-0.5 w-full overflow-hidden">
                    <span
                      className="bg-status-success"
                      style={{ width: `${flow.buyShare * 100}%` }}
                    />
                    <span
                      className="bg-status-error"
                      style={{ width: `${(1 - flow.buyShare) * 100}%` }}
                    />
                  </div>
                </div>
              )
            })()}
          </div>
          {trades.map((t, i) => {
            const price = formatPrice(t.price, market, precisionMode)
            const size = formatSize(t.amount, market, precisionMode)
            const time = tradeTimeLabel(t.timestamp)
            return (
              <button
                key={t.id ?? i}
                type="button"
                onClick={() => {
                  if (!sessionId) return
                  const flow = tradeFlow(trades)
                  askAgent(
                    sessionId,
                    buildTapePrintPrefill(
                      { connectionId, symbol },
                      {
                        side: t.side,
                        price,
                        size,
                        sizeUnit: sizeUnit(market).label || undefined,
                        time: time === '—' ? undefined : time,
                        flow: flow
                          ? { buyPct: Math.round(flow.buyShare * 100), prints: trades.length }
                          : undefined,
                      },
                    ),
                  )
                }}
                title={`Ask the agent about this ${t.side} print`}
                className="flex w-full items-center justify-between gap-2 px-2 py-px text-left text-2xs tabular-nums outline-none transition-colors hover:bg-surface-hover/60 focus-ring"
              >
                <span
                  className={cn(t.side === 'buy' ? 'text-status-success' : 'text-status-error')}
                >
                  {price}
                </span>
                <span className="ml-auto text-text-soft">{size}</span>
                {/* The print's clock — how a trader reads tape recency and speed. Undated → em-dash. */}
                <span className="w-16 text-right text-text-faint">{time}</span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
