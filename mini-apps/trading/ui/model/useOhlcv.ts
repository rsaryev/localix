import { useCallback, useEffect, useRef, useState } from 'react'
import type { Candle } from '../../backend/contracts'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import { TradingApiError, tradingApi } from '../api/tradingApi'
import { upsertCandles } from './candleSeries'
import { backfillRequest } from './backfill'
import type { TradingFailure } from '../problems'
import { useTradingStream } from './useTradingStream'

export interface OhlcvState {
  candles: Candle[]
  loading: boolean
  unreachable: boolean
  /** Why candles are missing, in the two halves the report has room for. */
  error: TradingFailure | null
  /** True while the venue websocket is pushing candle updates (the REST tail poll pauses). */
  live: boolean
  /**
   * Fetch the page of bars before the oldest one held. A no-op when there is nothing to fetch, a
   * fetch is already in flight, or the venue has already answered that nothing is older.
   *
   * Resolves with nothing: the chart measures a prepend from the series it is handed, because the
   * bars reach it on a later render than this promise settles on.
   */
  loadOlder: () => Promise<void>
}

/** The stored slice of {@link OhlcvState} — what a venue read produces, without the derived API. */
type OhlcvData = Omit<OhlcvState, 'loadOlder' | 'exhausted'>

// Keep the first paint light; older bars are fetched on demand when the trader pans left.
// This shortens the critical path without reducing the amount of history available overall.
const INITIAL_HISTORY_LIMIT = 300
const BACKFILL_LIMIT = 500

/**
 * SESSION cache of loaded candle series, keyed by target — so re-mounting a chart (switching
 * workspace tabs unmounts the inactive one) paints the LAST KNOWN series instantly instead of a
 * loading pane, while the normal history fetch revalidates behind it (stale-while-revalidate).
 * The fresh page is MERGED over the cached series, so backfilled older pages survive the round
 * trip. Bounded LRU — a dozen (market × timeframe) series at ≤ ~800 bars is a few MB at most.
 */
const CANDLE_CACHE_MAX = 12
const candleCache = new Map<string, Candle[]>()

function cacheWrite(target: string, candles: Candle[]): void {
  if (candles.length === 0) return
  if (candleCache.has(target)) candleCache.delete(target)
  candleCache.set(target, candles)
  while (candleCache.size > CANDLE_CACHE_MAX) {
    candleCache.delete(candleCache.keys().next().value!)
  }
}

/** A target's first state: its cached series (the fetch revalidates behind it) or a loading pane. */
function seedState(target: string): OhlcvData {
  const candles = candleCache.get(target) ?? []
  return { candles, loading: candles.length === 0, unreachable: false, error: null, live: false }
}

/** The buffered bars, but only when they belong to `target`. Bars held for another timeframe are
 *  measured in different units and merging them would silently corrupt the chart. */
export function buffered(pending: { target: string; candles: Candle[] }, target: string): Candle[] {
  return pending.target === target ? pending.candles : []
}
/** How many trailing bars the poll re-requests (the last closed + the in-progress one). */
const TAIL_LIMIT = 3

/**
 * Loads a market's candle history ONCE per (connection, symbol, timeframe), then keeps
 * it live by re-fetching only the TRAILING bars on a short, visibility-gated poll and
 * upserting them (the in-progress bar is replaced, a freshly-closed bar appended) — it
 * never re-pulls the whole history each tick. A hidden tab makes no round-trips; an
 * unreachable venue flips `unreachable` (a quiet state). Re-mounting (tab switches unmount
 * the hidden tab) is stale-while-revalidate via the session candle cache above — the last
 * known series paints on the first render, never a loading pane for a market already seen.
 */
export function useOhlcv(
  connectionId: string,
  symbol: string,
  timeframe: string,
  opts: { enabled?: boolean; intervalMs?: number } = {},
): OhlcvState {
  const enabled = (opts.enabled ?? true) && !!connectionId && !!symbol && !!timeframe
  const intervalMs = opts.intervalMs ?? 5000
  /** The target this hook is currently loading/serving: connection, symbol and timeframe. */
  const target = `${connectionId}/${symbol}/${timeframe}`
  // `loadOlder` / `exhausted` are derived below, not stored — the state is only what a read returns.
  // Seeded from the session cache so a re-mounted chart paints its last-known series on the very
  // first render (the history effect then revalidates it).
  const [state, setState] = useState<OhlcvData>(() => seedState(target))
  // A new target re-seeds the state while rendering — the same seed the first render used — so the
  // chart never paints a frame of the previous market's series. The history effect below only
  // resets the imperative buffers and fetches.
  const [seededFor, setSeededFor] = useState<string | null>(enabled ? target : null)
  if (enabled && seededFor !== target) {
    setSeededFor(target)
    setState(seedState(target))
  }
  const candlesRef = useRef<Candle[]>(candleCache.get(target) ?? [])
  /**
   * The target whose history has SETTLED, or `null`. Until it matches, a pushed bar must not reach
   * the chart: the websocket answers in milliseconds while the history request queues behind the
   * venue's other reads, so merging the push into an empty array renders a two-bar chart that only
   * fills in seconds later.
   *
   * It is a TARGET, not a boolean, because a stale push can outlive its subscription. Switching the
   * timeframe re-renders immediately, but both the unsubscribe and the buffer reset live in effects
   * that run after paint — and a socket frame delivered in that gap reaches the NEW callback while
   * the OLD subscription is still open. A boolean still read `settled`, so bars measured in hours
   * were merged into a chart asking for minutes. Comparing targets makes the stale frame unmatchable.
   */
  const settledTargetRef = useRef<string | null>(null)
  /** Pushes held until history lands, tagged with the target they belong to. */
  const pendingRef = useRef<{ target: string; candles: Candle[] }>({ target: '', candles: [] })
  /** A backfill in flight, keyed by target — a stale one must not prepend into a new chart. */
  const backfillingRef = useRef<string | null>(null)
  /** Targets whose history the venue has run out of. Asking again costs a throttled request and
   *  answers nothing; the chart's left edge is simply where this market's data begins. */
  const exhaustedRef = useRef<string | null>(null)

  const setCandles = useCallback(
    (candles: Candle[], patch?: Partial<OhlcvData>) => {
      candlesRef.current = candles
      cacheWrite(target, candles)
      setState((s) => ({ ...s, candles, ...patch }))
    },
    [target],
  )

  const degrade = useCallback((err: unknown) => {
    const unreachable =
      err instanceof TradingApiError &&
      (err.code === 'network_error' || err.code === 'not_connected')
    // A venue can refuse candles for ONE market while serving the rest of the tab (Coinbase
    // International's candle endpoint covers its perpetuals but not its spot "routing"
    // instruments) — say that, not the generic "does not support that operation".
    const notSupported = err instanceof TradingApiError && err.code === 'not_supported'
    setState((s) => ({
      ...s,
      loading: false,
      unreachable,
      // Only the ROUTE's message is a sentence; a transport throw ("Failed to fetch") is not, so
      // it is classified and its own words are kept for the record.
      error: unreachable
        ? null
        : notSupported
          ? {
              message:
                'This venue does not serve candle history for this market. The order book and trades beside the chart still work.',
            }
          : err instanceof TradingApiError
            ? { message: err.message, detail: err.detail }
            : {
                message: 'The candle history could not be read.',
                detail: err instanceof Error ? err.message : String(err),
              },
    }))
  }, [])

  // History load — resets its buffers and re-fetches whenever the target changes. A target the session cache
  // knows paints its last-known series immediately (loading stays false) while the fetch
  // revalidates behind it; an unknown one shows the loading pane as before.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const cached = candleCache.get(target) ?? []
    candlesRef.current = cached
    pendingRef.current = { target, candles: [] }
    settledTargetRef.current = null
    backfillingRef.current = null
    exhaustedRef.current = null
    void (async () => {
      try {
        const candles = await tradingApi.ohlcv(connectionId, symbol, {
          timeframe,
          limit: INITIAL_HISTORY_LIMIT,
        })
        if (cancelled) return
        // The fresh page lands OVER the cached series (backfilled older bars survive), then folds
        // in whatever the stream pushed FOR THIS TARGET while we waited, and opens the gate.
        candlesRef.current = upsertCandles(
          upsertCandles(cached, candles),
          buffered(pendingRef.current, target),
        )
        cacheWrite(target, candlesRef.current)
        pendingRef.current = { target, candles: [] }
        settledTargetRef.current = target
        setState((s) => ({
          ...s,
          candles: candlesRef.current,
          loading: false,
          unreachable: false,
          error: null,
        }))
      } catch (err) {
        if (cancelled) return
        // History is unavailable, but the stream may still be live. Release the buffered bars rather
        // than rendering an empty chart — the error/unreachable state says what is missing.
        settledTargetRef.current = target
        const held = buffered(pendingRef.current, target)
        if (held.length) {
          candlesRef.current = upsertCandles(candlesRef.current, held)
          pendingRef.current = { target, candles: [] }
          setState((s) => ({ ...s, candles: candlesRef.current }))
        }
        degrade(err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connectionId, symbol, timeframe, target, enabled, degrade])

  /**
   * Prepend the page of bars before the oldest one held. A page that ADDS nothing (not one that
   * returns nothing: the venue re-sends the boundary bar, which the merge treats as a correction)
   * means the history ends here, and this target stops asking.
   */
  const loadOlder = useCallback(async (): Promise<void> => {
    if (!enabled) return
    // Nothing to walk back from, a request already in flight, or a venue that already answered
    // "there is nothing older". Each guard is keyed to the TARGET, so switching timeframe or symbol
    // neither inherits the previous market's exhaustion nor lets its in-flight page land here.
    if (settledTargetRef.current !== target) return
    if (backfillingRef.current === target || exhaustedRef.current === target) return
    const oldest = candlesRef.current[0]
    if (!oldest) return
    const req = backfillRequest(oldest.time, timeframe, BACKFILL_LIMIT)
    if (!req) return

    backfillingRef.current = target
    try {
      const older = await tradingApi.ohlcv(connectionId, symbol, {
        timeframe,
        since: req.since,
        until: req.until,
        limit: Math.min(req.limit, BACKFILL_LIMIT),
      })
      // The target may have changed while the venue answered. Those bars belong to another chart.
      if (settledTargetRef.current !== target) return
      const before = candlesRef.current.length
      const merged = upsertCandles(candlesRef.current, older)
      if (merged.length > before) setCandles(merged, { unreachable: false, error: null })
      else exhaustedRef.current = target
    } catch (err) {
      // A failed page is not the end of the history — say what happened and let the trader retry by
      // scrolling again. Marking it exhausted here would turn a network blip into a permanent wall.
      degrade(err)
    } finally {
      if (backfillingRef.current === target) backfillingRef.current = null
    }
  }, [connectionId, symbol, timeframe, target, enabled, setCandles, degrade])

  // Tail poll — refetch only the trailing bars and merge them in.
  const pollTail = useCallback(async () => {
    const held = candlesRef.current
    // Ask from the OLDEST bar of the tail, not the newest. Anchoring on the last bar meant a bar
    // was never re-requested once the next one opened — so a venue's final close/high/low/volume,
    // which lands after the rollover, could never reach the chart. The merge treats an older bar
    // as a correction; the request has to actually fetch it.
    const from = held.at(-TAIL_LIMIT) ?? held.at(-1)
    if (!from) return // history hasn't seeded yet
    try {
      const tail = await tradingApi.ohlcv(connectionId, symbol, {
        timeframe,
        limit: TAIL_LIMIT,
        since: from.time * 1000, // Candle.time is seconds; `since` is ms
      })
      // The target may have changed while the venue answered (tab switched market/timeframe).
      // Without this guard the stale tail merges FOREIGN bars into the new series by timestamp —
      // and the captured setCandles then writes that hybrid into the OLD target's session cache,
      // which the SWR seed would faithfully repaint next open. Same guard loadOlder/onData carry.
      if (settledTargetRef.current !== target) return
      const merged = upsertCandles(candlesRef.current, tail)
      if (merged !== candlesRef.current) setCandles(merged, { unreachable: false, error: null })
    } catch (err) {
      degrade(err)
    }
  }, [connectionId, symbol, timeframe, target, setCandles, degrade])

  // Live candle stream: the pushed payload's rolling window (LAST bar in-progress) is merged
  // through the same `upsertCandles` the poll uses. Once it DELIVERS, the poll pauses.
  const { live, delivering } = useTradingStream({
    params: enabled ? { connectionId, channel: 'ohlcv', symbol, timeframe } : null,
    onData: (payload) => {
      if (payload.channel !== 'ohlcv') return
      if (settledTargetRef.current !== target) {
        // Either history has not landed yet, or this frame belongs to the target we just left.
        // Hold it under ITS OWN target: a frame carrying hourly bars must never be folded into the
        // minute chart the user just asked for, and a two-bar rolling window must never stand in for
        // a history that is still on its way.
        const held = buffered(pendingRef.current, target)
        pendingRef.current = { target, candles: upsertCandles(held, payload.candles) }
        return
      }
      const merged = upsertCandles(candlesRef.current, payload.candles)
      if (merged !== candlesRef.current) setCandles(merged, { unreachable: false, error: null })
    },
    onReconnect: () => void pollTail(),
  })

  useVisiblePolling({
    // `delivering`, not `live`: a candle subscription that came up and never pushed would otherwise
    // freeze the last bar and never open the next one — a chart of a market that looks dead.
    enabled: enabled && !delivering,
    intervalMs,
    // Return the promise so a slow tail fetch never overlaps the next tick (see useVisiblePolling).
    onTick: () => pollTail(),
    resetKey: `${connectionId}/${symbol}/${timeframe}/${String(delivering)}`,
  })

  return { ...state, live, loadOlder }
}
