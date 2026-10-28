import { useEffect, useMemo, useRef, useState } from 'react'
import type { Market } from '../../backend/contracts'
import { TradingApiError, tradingApi } from '../api/tradingApi'
import type { TradingFailure } from '../problems'

export interface MarketsState {
  markets: Market[]
  loading: boolean
  /** Set when the venue is unreachable — the sidebar shows a quiet retry hint. */
  unreachable: boolean
  /** Why the market list is missing, in the two halves the report has room for. */
  error: TradingFailure | null
}

/** The market list is CAPPED — a venue can list thousands of pairs. The cap is fair (per market
 *  type, see `backend/market-rank.ts`), but it is still a cap. */
const MARKET_LIMIT = 500
/** A keystroke is not a request. */
const SEARCH_DEBOUNCE_MS = 200

const EMPTY: MarketsState = { markets: [], loading: false, unreachable: false, error: null }

/**
 * Loads a connection's market list once it is live. `groupMarkets` filters and groups it locally,
 * so typing does not normally re-query the venue.
 *
 * But the list is capped at {@link MARKET_LIMIT} of what the venue offers, and a purely local
 * filter can only ever narrow the capped page: Hyperliquid lists 755 markets, so 255 of them —
 * all perpetuals — could not be found by typing their symbol. The `query` is therefore sent to the
 * server (debounced), which searches the WHOLE roster and returns a fresh capped page. Same
 * discipline as the composer `@`-menu, which needed the identical fix.
 *
 * Re-fetches when the connection changes; an unreachable venue is a quiet state, not an error.
 *
 * `reloadNonce` is the FORCED-REFRESH signal: bumping it re-fetches with `reload: true`, which makes
 * the server bypass its disk market-table cache and re-read the venue — the escape hatch for a
 * market listed since the cache was written. A connection/query change alone never forces a reload
 * (those serve the cached table, which is the whole point of the cache).
 */
export function useMarkets(
  connectionId: string | null,
  enabled: boolean,
  query = '',
  reloadNonce = 0,
  limit = MARKET_LIMIT,
): MarketsState {
  // The last read to settle, tagged with the request it answered. A request that has not settled
  // yet reads as `loading` over the previous page (which keeps filtering locally); a parked hook
  // (no connection, or disabled) reads as empty. Neither needs a state write in an effect.
  const request =
    connectionId && enabled ? JSON.stringify([connectionId, query, reloadNonce, limit]) : null
  const [settled, setSettled] = useState<{ request: string | null; value: MarketsState }>({
    request: null,
    value: EMPTY,
  })
  if (request === null && settled.request !== null) setSettled({ request: null, value: EMPTY })
  const pending = useMemo(() => ({ ...settled.value, loading: true }), [settled.value])
  const lastNonce = useRef(reloadNonce)

  useEffect(() => {
    if (!connectionId || !enabled || request === null) {
      lastNonce.current = reloadNonce
      return
    }
    // Only a nonce BUMP forces a venue reload — a connection/query change reuses the cache.
    const reload = reloadNonce !== lastNonce.current
    lastNonce.current = reloadNonce
    const search = query.trim()
    let cancelled = false
    const settle = (value: MarketsState) => setSettled({ request, value })
    // While this is in flight the previously-loaded page keeps filtering locally, so the list
    // narrows as you type rather than blanking and refilling.
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const markets = await tradingApi.markets(connectionId, {
              limit,
              ...(search ? { query: search } : {}),
              ...(reload ? { reload: true } : {}),
            })
            if (!cancelled) settle({ markets, loading: false, unreachable: false, error: null })
          } catch (err) {
            if (cancelled) return
            const unreachable =
              err instanceof TradingApiError &&
              (err.code === 'network_error' || err.code === 'not_connected')
            settle({
              markets: [],
              loading: false,
              unreachable,
              // Only the ROUTE's message is a sentence; a transport throw is not.
              error: unreachable
                ? null
                : err instanceof TradingApiError
                  ? { message: err.message, detail: err.detail }
                  : {
                      message: 'The market list could not be read.',
                      detail: err instanceof Error ? err.message : String(err),
                    },
            })
          }
        })()
      },
      search ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [connectionId, enabled, query, reloadNonce, limit, request])

  if (request === null) return EMPTY
  return settled.request === request ? settled.value : pending
}
