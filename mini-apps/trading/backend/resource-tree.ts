/**
 * The `localix://resource/trade` MENU TREE — what the composer `@`-menu drills, and nothing else.
 *
 * venue → market-type folder → market → market leaf; a credentialed connection keeps its account
 * category folders. Every container is linkable through its action row, so a user can stop at any
 * level. The markdown a node expands to lives in `resource-expand.ts`; the budgets these rows
 * ADVERTISE (and that the expansions must deliver) live in `resource-shared.ts`.
 *
 * The `@`-menu has no error channel. A failed read therefore rides in as a non-drillable NOTICE
 * ROW rather than a silently empty section: an empty Trading menu is indistinguishable from a
 * venue that lists nothing, and only one of those is worth acting on.
 *
 * Every such row is minted by the SHARED owner (`noticeNode` / `truncationNotice`), never
 * hand-rolled here. The owner is what sets `notice: true` — the flag the `@`-menu filters
 * selectable rows on — and keys the row off a `#notice` sentinel instead of an addressable
 * target. This file used to build its own, lost both, and so offered "Could not list venues"
 * as a pickable row carrying a real `localix://resource/trade/public%3Ahyperliquid` URI.
 */
import type { ExchangeCatalogEntry, Market } from './contracts'
import { MARKET_LEAVES, buildTradeUri, type MarketLeaf, type MarketTypeToken } from './uri'
import { MARKET_TYPE_ORDER, rankMarkets } from './market-rank'
import { DEFAULT_PUBLIC_EXCHANGE_ID, publicConnectionId } from './public-connection'
import {
  buildResourceUri,
  noticeNode,
  truncationNotice,
  type ResourceNode,
} from '@localixai/mini-app-sdk/backend'
import {
  BOOK_DEPTH,
  CANDLE_BARS,
  MARKET_TYPE_LABELS,
  MAX_MARKETS,
  PROVIDER,
  TRADE_PRINTS,
  findMarket,
  reason,
  type ResourceTradingService,
} from './resource-shared'

/** Catalog venues the root level lists before truncating (type to search the rest). */
const ROOT_VENUES = 12

/**
 * The ROOT nodes: the user's persisted connections (if any — the credentialed backend is
 * dormant, so usually none) followed by the venue CATALOG as `public:<exchange>` profiles.
 * The catalog is 100+ venues, so it is capped like a markets folder — default venue first,
 * then alphabetical — and the `query` reaches the FULL catalog so every venue stays typeable.
 */
export async function connectionNodes(
  service: ResourceTradingService,
  userId: string,
  query?: string,
): Promise<ResourceNode[]> {
  // Every source is a PUBLIC venue profile — there are no saved rows, because there are no
  // credentials to save. The roots are the venue catalog itself.
  const saved: ResourceNode[] = []

  let catalog: ExchangeCatalogEntry[]
  try {
    catalog = await service.exchanges()
  } catch (err) {
    // The menu has no error channel — a failed catalog rides in as a notice row, never as a
    // silently empty Trading section. The roots have no parent URI, so the notice is keyed off
    // the provider itself; what matters is that it is not addressable and not selectable.
    return [...saved, noticeNode(buildResourceUri(PROVIDER), 'Could not list venues', reason(err))]
  }
  const q = query?.trim().toLowerCase()
  const matching = q
    ? catalog.filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
    : catalog
  const sorted = [...matching].sort((a, b) => {
    if (a.id === DEFAULT_PUBLIC_EXCHANGE_ID) return -1
    if (b.id === DEFAULT_PUBLIC_EXCHANGE_ID) return 1
    return a.name.localeCompare(b.name)
  })
  const shown = sorted.slice(0, ROOT_VENUES)
  const venues: ResourceNode[] = shown.map((e) => ({
    uri: buildTradeUri({ kind: 'connection', connectionId: publicConnectionId(e.id) }),
    label: e.name,
    detail: 'public market data',
    hasChildren: true,
    icon: 'trading',
    actions: [{ id: 'link', label: 'Link this venue', kind: 'link' as const }],
  }))
  if (sorted.length > shown.length) {
    venues.push(
      truncationNotice(
        buildResourceUri(PROVIDER),
        shown.length,
        sorted.length,
        'venues',
        q ? query : undefined,
      ),
    )
  }
  return [...saved, ...venues]
}

/**
 * What sits under the Markets folder: the market-TYPE folders when the venue trades more
 * than one instrument type (spot vs perpetuals is a leveraged-vs-not distinction, not a
 * spelling one), else the markets directly — the same single-level skip the DB provider
 * applies to single-schema engines. A typed query ALWAYS searches markets flat, across
 * types: a user typing "BTC" wants instruments, not folders.
 */
export async function marketsLevelNodes(
  service: ResourceTradingService,
  userId: string,
  connectionId: string,
  query?: string,
): Promise<ResourceNode[]> {
  if (query?.trim()) return marketNodes(service, userId, connectionId, query)
  let all: Market[]
  try {
    all = await service.markets(userId, connectionId)
  } catch (err) {
    return [
      noticeNode(
        buildTradeUri({ kind: 'markets', connectionId }),
        'Could not list markets',
        reason(err),
      ),
    ]
  }
  const counts = new Map<string, number>()
  for (const m of all) counts.set(m.type, (counts.get(m.type) ?? 0) + 1)
  const types = MARKET_TYPE_ORDER.filter((t) => counts.has(t))
  if (types.length <= 1) return marketNodes(service, userId, connectionId, query)
  return types.map((t) => ({
    uri: buildTradeUri({ kind: 'marketType', connectionId, marketType: t as MarketTypeToken }),
    label: MARKET_TYPE_LABELS[t as MarketTypeToken] ?? t,
    detail: `${counts.get(t)} markets`,
    hasChildren: true,
    icon: 'markets',
  }))
}

/** The category folders under a connection: Markets (drillable) + the account/journal leaves. */
/** The markets inside a Markets/type folder, capped + honestly annotated when truncated. */
export async function marketNodes(
  service: ResourceTradingService,
  userId: string,
  connectionId: string,
  query?: string,
  type?: MarketTypeToken,
): Promise<ResourceNode[]> {
  // The query reaches the SERVICE, not just the returned page. A venue lists 755 markets and we
  // show 200 of them; filtering only the page would make the other 555 untypeable, and the
  // truncation notice below ("refine with search") a promise nothing could keep.
  // An `@`-menu that silently empties is indistinguishable from a venue that lists nothing. The
  // menu has no error channel, so the failure rides in as a non-drillable notice row — the same
  // shape the truncation notice already uses.
  let all: Market[]
  try {
    all = await service.markets(userId, connectionId, query || type ? { query, type } : undefined)
  } catch (err) {
    return [
      noticeNode(
        buildTradeUri({ kind: 'markets', connectionId }),
        'Could not list markets',
        reason(err),
      ),
    ]
  }
  // NOT `all.slice(0, MAX_MARKETS)`: a venue's own order is not a ranking, and Hyperliquid
  // returns 299 spot markets before its first perpetual — so an off-the-top cap listed zero of
  // the 456 instruments the venue exists for. `rankMarkets` gives each type a fair share.
  const { markets: shown, total, capped } = rankMarkets(all, MAX_MARKETS)
  const nodes: ResourceNode[] = shown.map((m) => ({
    uri: buildTradeUri({ kind: 'market', connectionId, symbol: m.symbol }),
    label: m.symbol,
    // Name the operator when a third party deployed this market. `AAPL` exists four times on
    // Hyperliquid — the exchange's own spot market plus one perp per builder, each with its own
    // liquidity and liquidation risk. Four rows reading `AAPL` with no distinguishing detail
    // would have the user link one and mean another.
    detail: `${m.type}${m.operator ? ` · by ${m.operator}` : ''}${m.active ? '' : ' · inactive'}`,
    hasChildren: true,
    icon: 'market',
    // Every node is linkable; give the market a nicer verb (git-provider precedent).
    actions: [{ id: 'link', label: 'Link this market', kind: 'link' }],
  }))
  if (capped) {
    // Say so IN a node rather than truncating silently — a non-drillable notice row.
    nodes.push(
      truncationNotice(
        buildTradeUri({ kind: 'markets', connectionId }),
        shown.length,
        total,
        'markets',
        query,
      ),
    )
  }
  return nodes
}

/**
 * The leaves under one market. `fills` is a CREDENTIALED read, so a `public:` profile never
 * lists it (the dormant execution backend would only refuse it); `funding` is the public
 * carry — listed on contract markets only, where the fact exists.
 */
export async function marketLeafNodes(
  service: ResourceTradingService,
  userId: string,
  connectionId: string,
  symbol: string,
): Promise<ResourceNode[]> {
  const market = await findMarket(service, userId, connectionId, symbol)
  const detail: Record<string, string> = {
    ticker: 'latest quote',
    candles: `last ${CANDLE_BARS} 1h bars`,
    orderbook: `top ${BOOK_DEPTH} per side`,
    trades: `last ${TRADE_PRINTS} prints`,
    funding: 'funding rate · open interest',
    technicals: 'technical rating · oscillators + MAs',
  }
  const leaves = MARKET_LEAVES.filter((leaf: MarketLeaf) => {
    // read) keeps the leaf — expansion will say what went wrong.
    if (leaf === 'funding' && market && !market.contract) return false
    return true
  })
  return leaves.map((leaf) => ({
    uri: buildTradeUri({ kind: 'marketLeaf', connectionId, symbol, leaf }),
    label: leaf,
    detail: detail[leaf],
    hasChildren: false,
    icon: leaf,
  }))
}
