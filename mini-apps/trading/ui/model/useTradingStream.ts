import { useEffect, useRef, useState } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { StreamPayload } from '../../backend/backend'
import {
  subscribeTradingStream,
  tradingStreamKey,
  type TradingStreamParams,
} from './tradingStreamClient'

export interface UseTradingStreamResult {
  /**
   * True while the venue websocket SUBSCRIPTION is up. This is a fact about the socket, not about
   * the market: the registry declares a stream `live` 800ms after its loop starts, whether or not
   * the symbol has printed anything. Use it to know the feed exists.
   */
  live: boolean
  /**
   * True once this subscription has actually DELIVERED a payload, and false again the moment it
   * goes down.
   *
   * This — not `live` — is what a REST fallback pauses on. A subscription that came up and then
   * said nothing leaves the caller with whatever it last read: no price at all for a ticker, a
   * frozen snapshot for an order book. Both read as facts about the market, and neither is one.
   * Delivery is a claim about NOW, so a stream going down clears it: the corpse of a subscription
   * must not keep a poll disabled.
   */
  delivering: boolean
}

/**
 * React binding over the shared, refcounted {@link subscribeTradingStream}. It owns NO
 * reconciled state — every payload is handed to the caller's `onData` so each surface folds
 * it into its own store (candles → `upsertCandles`, order book → replace, tape →
 * `reconcileTrades`) — and it returns the `live` flag that gates the caller's poll fallback.
 *
 * `params` = null disables the subscription (nothing to watch yet). A changed target
 * (connection / channel / symbol / timeframe) re-subscribes and clears `live`. The
 * subscription tears down on unmount; visibility pausing lives in the client module.
 *
 * `onReconnect` fires on TWO kinds of gap, because a DELTA channel cannot heal itself: our own
 * `/rpc/ws` reconnecting (the server-side subscriptions were dropped), and the registry restarting
 * the VENUE's socket (a `down` → `live` status edge, which leaves our own connection untouched).
 * Callers use it to REST-resync. Without the second, an order cancelled while the venue stream was
 * down is never pushed again and lingers in the open-orders view — a stop-loss the user believes
 * is armed.
 */
/**
 * The down→live edge, as a pure rule so it can be tested without a renderer.
 *
 * `wasDown` is whether we have seen a `down` we have not yet recovered from. A `live` status that
 * follows one means the venue's socket was restarted and a DELTA channel has a hole in it — the
 * caller must REST-resync. The FIRST `live` (no prior `down`) is just the subscription starting,
 * and must NOT trigger a resync.
 */
export function nextResyncState(
  wasDown: boolean,
  status: 'live' | 'down',
): { wasDown: boolean; resync: boolean } {
  if (status === 'down') return { wasDown: true, resync: false }
  return wasDown ? { wasDown: false, resync: true } : { wasDown: false, resync: false }
}

/**
 * Whether the subscription is DELIVERING, after one of the three things that can happen to it.
 *
 * Pure so the rule can be pinned without a renderer, because two of its three arms are exactly the
 * mistakes that make a REST fallback stop covering for a silent feed:
 *
 * - `data` — the only proof. This symbol printed.
 * - `live` — the socket LOOP came up (the registry says so 800ms after starting it). It proves
 *   nothing about this market, so it must leave delivery where it was. Treating it as delivery is
 *   what let a quiet market show no price at all.
 * - `down` — the feed is gone, whatever it delivered before. Delivery is a claim about NOW; if a
 *   dead subscription kept the flag, its corpse would keep the fallback disabled forever.
 */
export function nextDelivering(delivering: boolean, event: 'data' | 'live' | 'down'): boolean {
  if (event === 'data') return true
  if (event === 'down') return false
  return delivering
}

export function useTradingStream(opts: {
  params: TradingStreamParams | null
  onData: (payload: StreamPayload) => void
  onReconnect?: () => void
}): UseTradingStreamResult {
  const { params, onData, onReconnect } = opts
  const workItemVisible = useWorkItemVisible()
  const activeParams = workItemVisible ? params : null
  const [live, setLive] = useState(false)
  const [delivering, setDelivering] = useState(false)
  // Keep the callbacks in refs so an unstable closure never re-subscribes.
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  const onReconnectRef = useRef(onReconnect)
  onReconnectRef.current = onReconnect
  // True once this subscription has seen a `down` status it has not yet recovered from.
  const wasDownRef = useRef(false)

  const key = activeParams ? tradingStreamKey(activeParams) : ''

  useEffect(() => {
    setLive(false)
    setDelivering(false)
    wasDownRef.current = false
    if (!activeParams) return
    const unsubscribe = subscribeTradingStream(activeParams, {
      onData: (payload) => {
        setLive(true) // data proves the stream is live
        setDelivering((d) => nextDelivering(d, 'data'))
        onDataRef.current(payload)
      },
      onStatus: (status) => {
        setLive(status === 'live')
        setDelivering((d) => nextDelivering(d, status))
        // A down→live edge means the VENUE's socket was restarted by the registry. Our own
        // `/rpc/ws` never reconnected, so `onReconnect` below never fired — yet a DELTA channel
        // (`watchOrders`) missed every update in the gap, and an order cancelled while we were
        // down is never pushed again. Resync, or it lingers as an open order forever.
        const next = nextResyncState(wasDownRef.current, status)
        wasDownRef.current = next.wasDown
        if (next.resync) onReconnectRef.current?.()
      },
      onReconnect: () => onReconnectRef.current?.(),
    })
    return () => {
      unsubscribe()
      setLive(false)
      setDelivering(false)
      wasDownRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures every param field
  }, [key])

  return { live, delivering }
}
