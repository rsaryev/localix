import { useCallback, useState } from 'react'
import type { Ticker } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import { TradingApiError, tradingApi } from '../api/tradingApi'
import { useTradingStream } from './useTradingStream'
import { tickerPollPlan } from './tickerPoll'

export interface TickerState {
  ticker: Ticker | null
  loading: boolean
  /** Set when the venue is unreachable / the connection is down — a quiet hint, no toast. */
  unreachable: boolean
  error: string | null
  /** True while the venue websocket is pushing ticker updates (the REST poll pauses). */
  live: boolean
}

/**
 * Keeps one market's ticker (last / 24h change / high / low / volume) live: prefers the
 * venue websocket ticker stream, falling back to a bounded, visibility-gated REST poll when
 * the stream is down. The two never run at once — the poll is disabled while the stream is
 * live. A `network_error` / `not_connected` flips `unreachable` (a quiet state), no toast.
 *
 * `opts.emulated` says whether this venue's single-ticker read is synthesized from an expensive bulk
 * read; `undefined` means not yet known, and the poll stays off until it is (see `tickerPollPlan`).
 * The caller supplies it because the caller has ALREADY loaded the exchange's capabilities — this
 * hook used to fetch `describe` a second time for the one field it needed, which cost a redundant
 * round-trip per chart tab and, worse, made a second source of truth: its `catch` defaulted to
 * `native`, so a failed capabilities read fired the very bulk request the flag exists to hold back.
 */
export function useTicker(
  connectionId: string,
  symbol: string,
  opts: { enabled?: boolean; intervalMs?: number; emulated?: boolean } = {},
): TickerState {
  const enabled = (opts.enabled ?? true) && !!connectionId && !!symbol
  const intervalMs = opts.intervalMs ?? 4000
  const [state, setState] = useState<TickerState>({
    ticker: null,
    loading: true,
    unreachable: false,
    error: null,
    live: false,
  })

  const tick = useCallback(async () => {
    if (!connectionId || !symbol) return
    try {
      const ticker = await tradingApi.ticker(connectionId, symbol)
      setState((s) => ({ ...s, ticker, loading: false, unreachable: false, error: null }))
    } catch (err) {
      const unreachable =
        err instanceof TradingApiError &&
        (err.code === 'network_error' || err.code === 'not_connected')
      setState((s) => ({
        ...s,
        loading: false,
        unreachable,
        error: unreachable
          ? null
          : err instanceof Error
            ? err.message
            : 'Could not load the ticker.',
      }))
    }
  }, [connectionId, symbol])

  // Live ticker stream: a pushed ticker replaces state wholesale (it's a fresh snapshot).
  // `delivering`, not `live`: a subscription that came up and said nothing must not disable the
  // fallback, or a quiet market shows no price at all.
  const { live, delivering } = useTradingStream({
    params: enabled ? { connectionId, channel: 'ticker', symbol } : null,
    onData: (payload) => {
      if (payload.channel !== 'ticker') return
      setState((s) => ({
        ...s,
        ticker: payload.ticker,
        loading: false,
        unreachable: false,
        error: null,
      }))
    },
    onReconnect: () => void tick(),
  })

  const plan = tickerPollPlan({
    enabled,
    streamHasDelivered: delivering,
    emulated: opts.emulated,
    intervalMs,
  })

  useVisiblePolling({
    ...plan,
    // Return the promise so useVisiblePolling skips a tick while a slow read is still in flight —
    // no piling a second ticker request on an unfinished one.
    onTick: () => tick(),
    resetKey: `${connectionId}/${symbol}/${String(opts.emulated)}/${String(delivering)}`,
  })

  return { ...state, live }
}
