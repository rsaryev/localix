/**
 * The connection / market / roster expansions of the `localix://resource/trade` tree (`resource-expand.ts` —
 * see that module's header for the failed-read discipline these obey).
 */
import type { ExchangeInfo, Market, TradingConnectionInfo } from './contracts'
import type { MarketTypeToken } from './uri'
import { feesLine } from './fees'
import { connectionRules } from './connection-rules'
import { MARKET_TYPE_ORDER, rankMarkets } from './market-rank'
import type { ResourceExpansion } from '@localixai/mini-app-sdk/backend'
import {
  MARKET_TYPE_LABELS,
  MAX_MARKETS,
  findMarket,
  failureSentence,
  type ResourceTradingService,
} from './resource-shared'
import { contractCarryLines, num, oneLineTicker } from './resource-expand-quote'

export async function expandConnection(
  service: ResourceTradingService,
  userId: string,
  conn: TradingConnectionInfo,
  info: ExchangeInfo | null,
): Promise<ResourceExpansion> {
  const lines = [
    `Trading connection "${conn.name}" — ${conn.exchangeId}${conn.sandbox ? ' (sandbox)' : ''}.`,
    // The SAME rules line the `portfolio` and `manage_orders` rosters print, so the three can
    // never drift into describing different rules for one connection.
    `Rules: ${connectionRules(conn)} · ${conn.connected ? 'connected' : 'disconnected'}.`,
    // Whether credentials are present — the NAMES only, never a value.
    `Authenticated: ${conn.credentialFields.length ? 'yes' : 'no (public market data only)'}.`,
  ]
  if (info) {
    lines.push(`Timeframes: ${info.timeframes.join(', ') || '(none)'}.`)
  }
  // The venue's instrument roster by type — the fact a linked venue is FOR. Best-effort: a
  // venue whose market table could not be read still expands its identity lines.
  const markets = await service.markets(userId, conn.id).catch(() => null)
  if (markets) {
    const counts = new Map<string, number>()
    for (const m of markets) counts.set(m.type, (counts.get(m.type) ?? 0) + 1)
    const byType = MARKET_TYPE_ORDER.flatMap((t) =>
      counts.has(t) ? [`${counts.get(t)} ${t}`] : [],
    ).join(', ')
    lines.push(`Markets: ${markets.length}${byType ? ` (${byType})` : ''}.`)
  }
  return { ok: true, content: lines.join('\n') }
}

export async function expandMarket(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
): Promise<ResourceExpansion> {
  const market = await findMarket(service, userId, id, symbol)
  if (!market) return { ok: false, error: `The exchange does not list the market "${symbol}".` }
  const ticker = await service.ticker(userId, id, symbol).catch(() => null)
  const lines = [
    `**${market.symbol}** (${market.type}${market.contract ? ', contract' : ''}) — ${market.base}/${market.quote}.`,
    // An inactive (delisted/halted) market rejects a new order — lead with it, like `market_data`,
    // so a linked market view never reads as tradable when it is not.
    ...(!market.active
      ? [
          `Inactive: this market is delisted or halted — a new order will be rejected; only a reduce-only close may work.`,
        ]
      : []),
    // A third-party (HIP-3/builder) market carries the deployer's OWN liquidity + liquidation risk,
    // not the exchange's — the same warning `market_data` prints, so a linked view never hides it.
    ...(market.operator
      ? [
          `Deployed by ${market.operator}, a third party — NOT the exchange itself. Its liquidity and liquidation risk are its own; the same ticker may trade elsewhere under a different symbol.`,
        ]
      : []),
    `Precision: price ${num(market.precision.price)}, amount ${num(market.precision.amount)}.`,
    `Limits: min amount ${num(market.limits.minAmount)}, min cost ${num(market.limits.minCost)}, max leverage ${num(market.limits.maxLeverage)}.`,
    // The cost of trading, from the SAME `feesLine` the `market_data` tool prints — a linked market
    // view that omits it would read as free to trade.
    feesLine(market.fees),
  ]
  if (ticker) lines.push(oneLineTicker(ticker, market))

  // A derivative's carry cost and outstanding size. Only a contract has them.
  if (market.contract)
    lines.push(...(await contractCarryLines(service, userId, id, symbol, market)))
  return { ok: true, content: lines.join('\n') }
}

/**
 * A Markets/type folder expansion — the venue's roster, RANKED before capping (a venue's own
 * order is not a ranking; an off-the-top cap once listed zero Hyperliquid perpetuals). A failed
 * listing must never expand into "markets — 0": a venue that lists 755 markets and one that
 * could not be reached are not the same fact, and only one of them is safe to act on.
 */
export async function expandMarketsListing(
  service: ResourceTradingService,
  userId: string,
  connectionId: string,
  connName: string,
  type?: MarketTypeToken,
): Promise<ResourceExpansion> {
  let markets: Market[]
  try {
    markets = await service.markets(userId, connectionId, type ? { type } : undefined)
  } catch (err) {
    return { ok: false, error: failureSentence(err) }
  }
  const { markets: shown, total, capped } = rankMarkets(markets, MAX_MARKETS)
  const body = shown
    .map(
      (m) =>
        `- ${m.symbol} (${m.type}${m.operator ? `, by ${m.operator}` : ''}${m.active ? '' : ', inactive'})`,
    )
    .join('\n')
  const scope = type ? `${MARKET_TYPE_LABELS[type].toLowerCase()} markets` : 'markets'
  const more = capped ? `\n… ${total - shown.length} more (showing ${shown.length}).` : ''
  return { ok: true, content: `${connName} ${scope} — ${total}:\n${body || '(none)'}${more}` }
}
