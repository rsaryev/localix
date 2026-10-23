import type { CcxtExchange } from './ccxt-exchange'

/**
 * `params` that narrow a tickers read to the ONE market type the symbol belongs to, or `null` when
 * the read cannot be narrowed honestly.
 *
 * Why this exists. A venue whose `fetchTicker` is `'emulated'` has ccxt synthesize it from a bulk
 * read, and that bulk read can be far more than one request. Hyperliquid is the measured case: an
 * unscoped `fetchTickers()` walks spot, swap, AND every third-party HIP-3 "builder dex" it can
 * discover — 12 sequential requests, ~13s. Passing the symbol's own `type` cuts that to **one
 * request, ~1.9s**, because ccxt then reads only that type's endpoint.
 *
 * Two refusals, both deliberate:
 *
 * - **No loaded market, or no `type`** — we would be inventing a scope. Fall back.
 * - **A market that only the multi-dex read can reach** (ccxt flags these `info.hip3`, e.g.
 *   Hyperliquid's `XYZ-SP500/USDC:USDC`). Scoping to `type: 'swap'` would query the main perp
 *   endpoint, which does not list it, and we would report a live market as missing. These markets
 *   are real and users trade them, so they keep paying the full read rather than disappearing —
 *   the workbench lists every market the venue lists.
 */
export function tickerScope(ex: CcxtExchange, symbol: string): Record<string, unknown> | null {
  const market = ex.markets?.[symbol] as { type?: unknown; info?: { hip3?: unknown } } | undefined
  if (!market || market.info?.hip3) return null
  return typeof market.type === 'string' && market.type ? { type: market.type } : null
}

/**
 * The builder-dex scope (`{ dex }`) for a HIP-3 market, recovered from the LOADED market's own
 * venue data — or `null` for any ordinary market.
 *
 * Hyperliquid lists third-party "builder dex" perp markets (e.g. `XYZ-SP500/USDC:USDC`) whose asset
 * contexts — mark price, oracle/index price, funding, open interest — live behind a per-dex request
 * `{ type: 'metaAndAssetCtxs', dex: '<name>' }`. Without the `dex`, ccxt's plural funding read (and
 * the swap-markets read behind open interest) hit the MAIN perps context, which does not carry a
 * builder market, so the venue returns nothing and Mark/Index/Funding/OI all vanish together.
 *
 * The dex name is taken from the venue's OWN data, never by case-mangling our unified symbol: ccxt's
 * HIP-3 markets carry `info.hip3 === true` and `info.name` as `'<dex>:<token>'` (the venue's own
 * lower-case dex name, e.g. `xyz:XYZ100`, `flx:crcl` — see ccxt `hyperliquid.fetchHip3Markets`).
 * Returned only when BOTH the flag is set AND the name is a well-formed `'<dex>:<token>'` pair with
 * non-empty halves; anything else (an ordinary market, a plain hyphen like `ZM-USDC`, a `dex`-less
 * or malformed name) yields `null` and the caller keeps its exact current, unscoped behaviour rather
 * than inventing a dex.
 */
export function hip3Scope(ex: CcxtExchange, symbol: string): { dex: string } | null {
  const market = ex.markets?.[symbol] as
    | { info?: { hip3?: unknown; name?: unknown; dex?: unknown } }
    | undefined
  const info = market?.info
  if (info?.hip3 !== true) return null
  // The venue STATES the dex (`info.dex`), and ccxt.pro's own `watchTicker` reads that same field to
  // scope its subscription. Prefer it: a stated fact beats a parsed one, and it is the only source
  // that stays right if a dex or token name ever contains the separator we would otherwise split on.
  if (typeof info.dex === 'string' && info.dex) return { dex: info.dex }
  // Fallback for a venue/ccxt version that flags the market but does not state its dex: the name is
  // `<dex>:<token>`. Still flag-gated, still refusing anything malformed rather than inventing one.
  if (typeof info.name !== 'string') return null
  const parts = info.name.split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { dex: parts[0] }
}

/**
 * How many venue requests ONE page of prices may cost. Each read is a throttled request in the
 * venue's SERIAL queue (~1s on Hyperliquid), and the picker re-reads whenever the page changes, so
 * this bounds what a keystroke can do to the chart polling behind it. Buckets beyond the budget are
 * left unpriced — a blank price column is honest; a four-second picker is not.
 */
export const MAX_SCOPED_TICKER_READS = 4

/** One planned request: a market-TYPE read, or a builder-DEX context read. */
export interface ScopedTickerRead {
  /** `type:swap` / `dex:xyz` — stable, so a plan is comparable in a test. */
  key: string
  kind: 'type' | 'dex'
  /** The `type` name or the `dex` name this read is scoped to. */
  scope: string
  symbols: string[]
}

/**
 * Group `symbols` into the cheapest set of scoped reads, bounded by `max`.
 *
 * Every symbol the venue lists belongs to exactly one scope that answers in ONE request:
 *
 * - an ordinary market → its market TYPE (`fetchTickers(bucket, { type })` reads only that type's
 *   endpoint, so a bucket of any size costs one request);
 * - a HIP-3 builder market → its own DEX context (`fetchSwapMarkets({ dex })`, which carries a
 *   ticker for every market that dex lists). Scoping it by `type` instead would query the main-perps
 *   endpoint that does not list it, and report a live market as absent.
 *
 * A symbol the venue does not list has no scope and is simply dropped — we have nothing to invent
 * one from.
 *
 * Buckets are ordered by how many of the page's rows each one prices, so the budget buys the most
 * prices it can: on Hyperliquid one `dex:xyz` read prices 100 of the 225 builder markets. Ties break
 * on the key, so the plan is deterministic. Reads past the budget are reported in `dropped` rather
 * than silently vanishing — those symbols render with no price, never with a zero and never with
 * another market's number.
 */
export function planScopedTickerReads(
  ex: Pick<CcxtExchange, 'markets'>,
  symbols: string[],
  max: number = MAX_SCOPED_TICKER_READS,
): { reads: ScopedTickerRead[]; dropped: string[] } {
  const e = ex as CcxtExchange
  const buckets = new Map<string, ScopedTickerRead>()
  const dropped: string[] = []
  for (const symbol of symbols) {
    const dex = hip3Scope(e, symbol)?.dex
    const type = dex ? undefined : tickerScope(e, symbol)?.type
    const planned: Omit<ScopedTickerRead, 'symbols'> | null = dex
      ? { key: `dex:${dex}`, kind: 'dex', scope: dex }
      : typeof type === 'string' && type
        ? { key: `type:${type}`, kind: 'type', scope: type }
        : null
    if (!planned) {
      dropped.push(symbol)
      continue
    }
    const bucket = buckets.get(planned.key)
    if (bucket) bucket.symbols.push(symbol)
    else buckets.set(planned.key, { ...planned, symbols: [symbol] })
  }
  const ranked = [...buckets.values()].sort(
    (a, b) => b.symbols.length - a.symbols.length || a.key.localeCompare(b.key),
  )
  const reads = ranked.slice(0, Math.max(0, max))
  for (const over of ranked.slice(Math.max(0, max))) dropped.push(...over.symbols)
  return { reads, dropped }
}
