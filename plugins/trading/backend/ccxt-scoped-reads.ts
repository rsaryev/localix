/**
 * CHEAPEST-READ POLICY for the ccxt driver: how to read one (or many) symbols' ticker, funding rate,
 * open interest and contract stats WITHOUT paying a venue's whole-market fan-out.
 *
 * Why this is its own module. ccxt's convenience methods are written for the common venue, and on an
 * `'emulated'` venue they synthesize a single-symbol read out of a BULK one — measured on
 * Hyperliquid, an unscoped `fetchTicker` costs ~13s of SERIAL throttle queue, with every other read
 * for that connection waiting behind it. Every function here exists to turn one of those fan-outs
 * into a bounded set of ONE-REQUEST reads, and each one carries the measurement that justifies it.
 * Keeping the policy together (rather than scattered through the driver) is what makes it reviewable
 * as a whole, and every function is exported + structural so it is unit-tested offline against a
 * plain-object fake — no ccxt, no network.
 *
 * The two scopes a venue offers, and the one rule they obey: a read is only narrowed when the venue's
 * OWN loaded market data says how. Nothing here invents a scope, and a symbol it cannot narrow keeps
 * its exact previous (possibly expensive) path rather than silently coming back empty.
 */
import type { CcxtExchange } from './ccxt-exchange'
import type { OperationSupport, Ticker } from './contracts'
import { normalizeTicker } from './normalize'

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
function tickerScope(ex: CcxtExchange, symbol: string): Record<string, unknown> | null {
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
 * Read ONE symbol's ticker as cheaply as the venue allows: a scoped read when `tickerScope` can
 * narrow it, else ccxt's own single-symbol read (which on an emulated venue is the whole-venue
 * fan-out). `null` when nothing readable came back.
 *
 * Shared by the public `fetchTicker` AND by the reference price a MARKET order needs. That sharing
 * is the point: the order path used to call `ex.fetchTicker` directly, so submitting a market order
 * on Hyperliquid queued twelve throttled requests — about thirteen seconds — BEFORE the order was
 * sent, and then priced its slippage bound off a quote that age had already invalidated.
 */
export async function readTickerScoped(
  ex: Pick<
    CcxtExchange,
    'markets' | 'fetchTicker' | 'fetchTickers' | 'fetchSwapMarkets' | 'parseTicker'
  >,
  symbol: string,
): Promise<Ticker | null> {
  const scope = tickerScope(ex as CcxtExchange, symbol)
  if (scope) {
    // A scoped read asks the venue for ONE market type instead of every type it lists. When it
    // comes back carrying our symbol we are done; anything else falls through to ccxt's own
    // (possibly emulated, possibly very expensive) single-symbol read rather than guessing.
    const map = await ex.fetchTickers([symbol], scope)
    const scoped = normalizeTicker(map[symbol], symbol)
    if (scoped) return scoped
  }
  const hip3 = await readHip3TickerRaw(ex, symbol)
  if (hip3 !== undefined) {
    const scoped = normalizeTicker(hip3, symbol)
    if (scoped) return scoped
  }
  return normalizeTicker(await ex.fetchTicker(symbol), symbol)
}

/**
 * What ONE symbol's ticker costs this venue: `'cheap'` = a single request, `'bulk'` = the
 * whole-venue read ccxt synthesizes an emulated `fetchTicker` from.
 *
 * The service asks this before choosing how to serve an emulated ticker — a `cheap` symbol is cached
 * per symbol, a `bulk` one is served out of ONE shared whole-venue map (N bulk symbols must never
 * cost N whole-venue reads). So this answer must track what {@link readTickerScoped} can actually
 * do, or the cheap path it opened is never taken: a builder market's dex read is one request, and
 * calling it `bulk` kept every HIP-3 chart on the twelve-request map.
 *
 * Both scopes mean exactly one request — a by-type read for an ordinary market, a dex-context read
 * for a builder one. Anything neither can narrow is genuinely bulk.
 */
export function tickerReadCostFor(
  ex: Pick<CcxtExchange, 'markets'>,
  symbol: string,
): 'cheap' | 'bulk' {
  const e = ex as CcxtExchange
  return tickerScope(e, symbol) || hip3Scope(e, symbol) ? 'cheap' : 'bulk'
}

/**
 * One HIP-3 builder market's ticker, read from its OWN dex context. `undefined` for any ordinary
 * market (there is nothing to scope) and for a dex context that does not carry the symbol.
 *
 * `tickerScope` deliberately refuses a builder market: scoping it to `type: 'swap'` would query the
 * main perps endpoint, which does not list it. So such a market fell all the way through to ccxt's
 * emulated `fetchTicker` — the whole-venue fan-out — on EVERY read: the chart's REST fallback, and
 * the reference price a market order is sized against. Measured on `XYZ-SP500/USDC:USDC`: **11062ms**.
 *
 * But its dex context is one request, and it carries the very fields ccxt's own `fetchTickers`
 * parses a ticker from — `fetchTickers` calls `parseTicker(market.info, market)` over exactly the
 * market objects `fetchSwapMarkets` returns. So we take that one request and make ccxt's own parser
 * read it: **1416ms**, and every field identical (`last`, `bid`, `ask`, `previousClose`,
 * `quoteVolume`, and the same `undefined`s where the venue reports nothing).
 *
 * This is the third read (after funding and open interest) that a builder market can only serve
 * through `fetchSwapMarkets(scope)`, because ccxt's convenience wrappers drop `params` on the way.
 */
export async function readHip3TickerRaw(
  ex: Pick<CcxtExchange, 'markets' | 'fetchSwapMarkets' | 'parseTicker'>,
  symbol: string,
): Promise<unknown> {
  const scope = hip3Scope(ex as CcxtExchange, symbol)
  if (!scope) return undefined
  const swapMarkets = await ex.fetchSwapMarkets(scope)
  const market = swapMarkets.find((m) => (m as { symbol?: unknown }).symbol === symbol)
  const info = (market as { info?: unknown } | undefined)?.info
  if (!market || info === undefined) return undefined
  return ex.parseTicker(info, market)
}

/**
 * The raw ccxt funding-rate reply for one symbol, forwarding a HIP-3 dex scope when present.
 *
 * A `native` venue serves the single-symbol read directly. An `emulated` venue (Hyperliquid) serves
 * only the plural `fetchFundingRates`, and THAT is where the dex scope must ride: passing `{ dex }`
 * as `params` makes ccxt read the builder-dex context instead of the main perps one. An ordinary
 * market passes no scope, so its request count and shape are exactly as before.
 */
export async function readFundingRateRaw(
  ex: Pick<CcxtExchange, 'markets' | 'fetchFundingRate' | 'fetchFundingRates'>,
  symbol: string,
  support: OperationSupport,
): Promise<unknown> {
  if (support === 'native') return ex.fetchFundingRate(symbol)
  const scope = hip3Scope(ex as CcxtExchange, symbol)
  const map = await ex.fetchFundingRates([symbol], scope ?? undefined)
  return map[symbol]
}

/**
 * The raw ccxt open-interest reply for one symbol.
 *
 * ccxt's own `fetchOpenInterest`/`fetchOpenInterests` DROP `params` on the way to `fetchSwapMarkets`,
 * so a builder-dex scope can never reach the request through them — an OI read for a HIP-3 market
 * would silently come back empty. For a dex-scoped market we therefore call `fetchSwapMarkets(scope)`
 * (which DOES forward params) and reuse ccxt's OWN `parseOpenInterests` over the returned market
 * objects, keying the result by our unified symbol — the same two steps ccxt's `fetchOpenInterests`
 * takes, differing only in that the scope survives. An ordinary market keeps ccxt's exact native
 * path (one `fetchOpenInterest` call, unchanged behaviour and request count).
 */
export async function readOpenInterestRaw(
  ex: Pick<
    CcxtExchange,
    'markets' | 'fetchOpenInterest' | 'fetchSwapMarkets' | 'parseOpenInterests'
  >,
  symbol: string,
): Promise<unknown> {
  const scope = hip3Scope(ex as CcxtExchange, symbol)
  if (!scope) return ex.fetchOpenInterest(symbol)
  const swapMarkets = await ex.fetchSwapMarkets(scope)
  const ois = ex.parseOpenInterests(swapMarkets, [symbol])
  return ois[symbol]
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

/**
 * Prices for many symbols WITHOUT the whole-venue fan-out an unscoped multi-ticker read costs on an
 * emulated venue.
 *
 * {@link planScopedTickerReads} turns the page into a bounded set of one-request reads; this runs
 * them. A `type` bucket goes through ccxt's `fetchTickers(bucket, { type })`; a `dex` bucket reads
 * that builder dex's context once and hands each market to ccxt's OWN `parseTicker` — the same call
 * `fetchTickers` makes internally, so no ticker shape is hand-rolled. A `hip3`-first bucket can never
 * be handed to `fetchTickers`, so ccxt's own "first symbol is hip3 ⇒ read every builder dex" branch
 * is never triggered.
 *
 * A bucket that THROWS costs its symbols their prices, not the whole page: the venue answering for
 * `spot` while the `xyz` dex times out should still price the spot rows.
 *
 * Returns a raw ccxt tickers map keyed by unified symbol, a SUBSET of `symbols`; the caller
 * normalizes and keys by symbol, and a symbol missing from the map is simply unpriced.
 */
export async function readScopedTickersRaw(
  ex: Pick<CcxtExchange, 'markets' | 'fetchTickers' | 'fetchSwapMarkets' | 'parseTicker'>,
  symbols: string[],
): Promise<Record<string, unknown>> {
  const { reads } = planScopedTickerReads(ex, symbols)
  const out: Record<string, unknown> = {}
  for (const read of reads) {
    try {
      if (read.kind === 'type') {
        const map = await ex.fetchTickers(read.symbols, { type: read.scope })
        for (const [symbol, t] of Object.entries(map)) out[symbol] = t
        continue
      }
      const wanted = new Set(read.symbols)
      const dexMarkets = await ex.fetchSwapMarkets({ dex: read.scope })
      for (const market of dexMarkets) {
        const m = market as { symbol?: unknown; info?: unknown }
        if (typeof m.symbol !== 'string' || !wanted.has(m.symbol) || m.info === undefined) continue
        out[m.symbol] = ex.parseTicker(m.info, market)
      }
    } catch {
      // One scope's failure leaves its rows unpriced; the rest of the page still gets its numbers.
    }
  }
  return out
}

/**
 * A contract's funding rate AND open interest from ONE venue read.
 *
 * Hyperliquid answers `metaAndAssetCtxs` with mark, index, funding, open interest and volume for
 * every market at once, and ccxt then exposes them through two methods that each issue that request
 * again. Reading both cost two of them — two full seconds of the venue's SERIAL throttle queue, on
 * one payload, with every other read for that connection waiting behind the second.
 *
 * So take the payload once (`fetchSwapMarkets`, dex-scoped for a builder market) and hand it to
 * ccxt's OWN parsers. `Market.info` from that call is exactly the merged universe+context dict
 * `parseFundingRate` documents as its input, and `parseOpenInterests` already consumes the markets
 * themselves. Nothing about either shape is hand-rolled here.
 *
 * A market the venue does not return is `null` on both counts — never a fabricated zero.
 */
export async function readContractStatsRaw(
  ex: Pick<
    CcxtExchange,
    'markets' | 'fetchSwapMarkets' | 'parseOpenInterests' | 'parseFundingRates'
  >,
  symbol: string,
): Promise<{ funding: unknown; openInterest: unknown }> {
  const scope = hip3Scope(ex as CcxtExchange, symbol)
  const swapMarkets = await ex.fetchSwapMarkets(scope ?? undefined)
  const infos = swapMarkets
    .map((m) => (m as { info?: unknown }).info)
    .filter((i): i is object => !!i)
  const funding = ex.parseFundingRates(infos, [symbol])[symbol]
  const openInterest = ex.parseOpenInterests(swapMarkets, [symbol])[symbol]
  return { funding, openInterest }
}
