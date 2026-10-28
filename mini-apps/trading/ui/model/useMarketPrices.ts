import { useEffect, useMemo, useState } from 'react'
import type { Ticker } from '../../backend/contracts'
import { tradingApi } from '../api/tradingApi'

/** A keystroke is not a request — the displayed page changes as the user types. */
const PRICE_DEBOUNCE_MS = 250

/**
 * Fetches last prices for the symbols a market picker is CURRENTLY showing — the ranked, capped,
 * filtered page, not the venue's whole roster — over the cheap scoped multi-ticker read.
 *
 * Discipline:
 *  - Debounced, so it never fires on every keystroke; the page settles, then one read lands.
 *  - Keyed on the exact symbol SET, so a re-render with the same rows does not re-fetch and a
 *    changed page supersedes the previous read (its late result is dropped).
 *  - Cancelled on unmount and on a changed page — a stale in-flight read can never write prices for
 *    a page that has moved on.
 *  - A read that fails or that omits a symbol leaves that symbol WITHOUT a price. The returned map
 *    is keyed by symbol, so a value is only ever shown against the exact market it belongs to;
 *    absence is "no price right now", never a `0` and never another market's number.
 *
 * Returns a `Map<symbol, Ticker>` — a symbol absent from it has no price to show.
 */
export function useMarketPrices(
  connectionId: string | null,
  symbols: string[],
  enabled: boolean,
): Map<string, Ticker> {
  const [prices, setPrices] = useState<Map<string, Ticker>>(() => new Map())

  // Stable identity for the effect: the sorted symbol set. Two renders showing the same rows share
  // one key (no re-fetch); a different page is a different key (supersede + re-fetch).
  const key = useMemo(() => [...symbols].sort().join(','), [symbols])

  // A parked hook (no venue, disabled, or no rows) drops what it held while rendering, so a
  // later re-enable never flashes the old page's prices.
  const parked = !connectionId || !enabled || key === ''
  if (parked && prices.size > 0) setPrices(new Map())

  useEffect(() => {
    if (!connectionId || !enabled || key === '') return
    const list = key.split(',')
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const tickers = await tradingApi.marketTickers(connectionId, list)
          if (cancelled) return
          setPrices(new Map(tickers.map((t) => [t.symbol, t])))
        } catch {
          // A failed price read is not an error state — the rows already render without prices, and
          // a wrong/stale number would be worse than a blank column. Drop what we had for this page.
          if (!cancelled) setPrices(new Map())
        }
      })()
    }, PRICE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [connectionId, enabled, key])

  return prices
}
