import { localixResourceUri, parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

/**
 * PURE `localix://resource/trade` URI grammar — the one source of truth for the trading resource tree,
 * shared by the backend resource provider AND the UI (which imports these builders +
 * the category/leaf token sets, exactly as the Docker mini app's UI imports
 * `DOCKER_CATEGORIES` from `../backend/contracts`). No IO, no imports: a small total
 * parser + builder over a discriminated union.
 *
 * Grammar (positional):
 *   localix://resource/trade/<connectionId>                                → the connection/venue (root)
 *   localix://resource/trade/<connectionId>/markets                        → the Markets folder
 *   localix://resource/trade/<connectionId>/markets/<type>                 → one market-TYPE folder
 *                                                            (spot|swap|future|margin|option)
 *   localix://resource/trade/<connectionId>/markets/<encSymbol>            → one market
 *   localix://resource/trade/<connectionId>/markets/<encSymbol>/<leaf>     → a market leaf
 *   localix://resource/trade/<connectionId>/markets/<encSymbol>/{candles|technicals}/<timeframe>
 *                                                         → a timeframe-specific live view
 *   localix://resource/trade/<connectionId>/positions|balance|orders|fills|funding → an account leaf
 *   localix://resource/trade/<connectionId>/history                        → the workbench's own order journal
 *
 * The market-TYPE folder shares the symbol's position: a third segment is a type folder iff it
 * is one of the lowercase {@link MARKET_TYPE_TOKENS}, else it decodes as a symbol. The two can
 * never collide — a unified ccxt symbol always contains `/` (`BASE/QUOTE…`), so a bare
 * `spot`/`swap` token is not a possible symbol. The type level is pure NAVIGATION: a market
 * keeps its canonical typeless `markets/<encSymbol>` URI whichever folder it was reached
 * through, so a link minted before the type level existed is byte-identical to one minted after.
 *
 * `fills` appears BOTH as a market leaf (this market's own executed trades) and as an account
 * leaf (the account's, across markets) — the same data at two scopes, like `orders`.
 *
 * `funding` appears at BOTH scopes too, but they are different FACTS: the MARKET leaf is the
 * instrument's public carry — its current funding rate + open interest (public reads, listed on
 * contract markets only) — while the ACCOUNT leaf is the account's own settled funding payments
 * (a credentialed read; the venue reports no per-position accrued funding through the agnostic
 * port). Both are DISTINCT from `history` (our journal of order INTENT).
 *
 * A unified market symbol carries `/` and `:` (e.g. `BTC/USDC:USDC`), so it is
 * `encodeURIComponent`'d into ONE opaque path segment — it must NEVER be split across
 * segments. Every other segment is an opaque id/token; a literal `.`/`..` segment is
 * rejected outright (it can only be a crafted traversal, never a real id).
 */

/** Top-level folders under a venue. `markets` is the only one — there is no account to fold. */
export const TRADE_CATEGORIES = ['markets'] as const

/** The leaves under a single market. `trades` is the venue-wide tape; `funding` is the
 *  instrument's public carry (rate + open interest, contract markets only). */
export const MARKET_LEAVES = [
  'ticker',
  'candles',
  'orderbook',
  'trades',
  'funding',
  // The server-computed technical rating (oscillator + MA votes, gauges) plus
  // the house lenses — so a linked Technicals tab (or an `@` to this leaf) carries the summary
  // WITHOUT the tab ever being opened; the math runs on demand from freshly-read candles.
  'technicals',
] as const
export type MarketLeaf = (typeof MARKET_LEAVES)[number]

/** Market-TYPE folder tokens — MUST mirror `marketTypeSchema` in `contracts.ts` (this file stays
 *  import-free so the UI can bundle it; a test pins the two together). Lowercase on purpose: the
 *  parser distinguishes a type folder from an encoded symbol by membership in this set. */
export const MARKET_TYPE_TOKENS = ['spot', 'swap', 'future', 'margin', 'option'] as const
export type MarketTypeToken = (typeof MARKET_TYPE_TOKENS)[number]

const MARKET_TYPE_SET: ReadonlySet<string> = new Set<string>(MARKET_TYPE_TOKENS)

const MARKET_LEAF_SET: ReadonlySet<string> = new Set<string>(MARKET_LEAVES)

/** A node in the `localix://resource/trade` tree — the discriminated union {@link parseTradeUri} yields. */
export type TradeUriNode =
  | { kind: 'connection'; connectionId: string }
  | { kind: 'markets'; connectionId: string }
  | { kind: 'marketType'; connectionId: string; marketType: MarketTypeToken }
  | { kind: 'market'; connectionId: string; symbol: string }
  | {
      kind: 'marketLeaf'
      connectionId: string
      symbol: string
      leaf: MarketLeaf
      /** Optional only for candles/technicals; mini-app-owned live-view refinement. */
      timeframe?: string
    }

/** Build the canonical `localix://resource/trade` URI for a node. Total; round-trips with {@link parseTradeUri}. */
export function buildTradeUri(node: TradeUriNode): string {
  switch (node.kind) {
    case 'connection':
      return localixResourceUri('trade', [node.connectionId])
    case 'markets':
      return localixResourceUri('trade', [node.connectionId, 'markets'])
    case 'marketType':
      return localixResourceUri('trade', [node.connectionId, 'markets', node.marketType])
    case 'market':
      return localixResourceUri('trade', [node.connectionId, 'markets', node.symbol])
    case 'marketLeaf':
      return localixResourceUri('trade', [
        node.connectionId,
        'markets',
        node.symbol,
        node.leaf,
        ...(node.timeframe ? [node.timeframe] : []),
      ])
  }
}

/**
 * Parse a `localix://resource/trade` URI into a {@link TradeUriNode}, or `null` for anything malformed —
 * a wrong resource provider, an unknown category/leaf, a `.`/`..` traversal segment, or a symbol that
 * fails to decode. Total and side-effect-free.
 */
export function parseTradeUri(uri: string): TradeUriNode | null {
  const parsed = parseLocalixUri(uri)
  if (parsed?.primitive !== 'resource' || parsed.breadcrumbs[0] !== 'trade') return null
  const raw = parsed.breadcrumbs.slice(1)
  // Every segment is an opaque id/token — a relative `.`/`..` can only be a crafted path,
  // never a legitimate connection id / category / symbol.
  if (raw.some((s) => s === '.' || s === '..')) return null

  const [connectionId, category, symbolSeg, leafSeg, refinementSeg] = raw
  if (!connectionId) return null

  // localix://resource/trade/<conn>
  if (raw.length === 1) return { kind: 'connection', connectionId }

  // markets subtree — the only category there is.
  if (category === 'markets') {
    if (raw.length === 2) return { kind: 'markets', connectionId }
    // A lowercase type token in the symbol position is a TYPE folder — a unified symbol always
    // contains `/`, so the two vocabularies cannot collide.
    if (raw.length === 3 && symbolSeg && MARKET_TYPE_SET.has(symbolSeg)) {
      return { kind: 'marketType', connectionId, marketType: symbolSeg as MarketTypeToken }
    }
    const symbol = symbolSeg!
    if (!symbol) return null
    if (raw.length === 3) return { kind: 'market', connectionId, symbol }
    if (raw.length === 4 && leafSeg && MARKET_LEAF_SET.has(leafSeg)) {
      return { kind: 'marketLeaf', connectionId, symbol, leaf: leafSeg as MarketLeaf }
    }
    if (raw.length === 5 && (leafSeg === 'candles' || leafSeg === 'technicals') && refinementSeg) {
      const timeframe = refinementSeg
      if (!/^\d{1,4}[a-zA-Z]$/.test(timeframe)) return null
      return { kind: 'marketLeaf', connectionId, symbol, leaf: leafSeg, timeframe }
    }
    return null
  }

  return null
}
