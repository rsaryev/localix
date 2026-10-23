/**
 * TRADING search provider (agent-core search) — matches trading connections (by name /
 * exchange id) and their markets (by unified symbol / base / quote) over the exchange
 * workbench. `lazy`: it hits a live exchange to enumerate markets, so it runs ONLY when
 * the Trading scope is explicitly selected (an unreachable venue degrades to [] and never
 * stalls a default query). Hit ids reuse the `localix://resource/trade` grammar so a result opens /
 * drag-links straight into chat.
 */
import { buildTradeUri } from './uri'
import type { SearchHit, SearchProvider } from '@localixai/mini-app-sdk/backend'
import { bestFieldScore } from '@localixai/mini-app-sdk/backend'

export interface TradingSearchConnection {
  id: string
  name: string
  exchangeId: string
  connected: boolean
}
export interface TradingSearchMarket {
  symbol: string
  base: string
  quote: string
  /** `spot` / `swap` / … — what separates a spot buy from a leveraged one. */
  type: string
  /** The third party that deployed this market, when one did. */
  operator?: string
  /** `false` = delisted / halted. A hit that does not say so reads as tradable when it is not. */
  active?: boolean
}

/** Narrow port — the two enumerations this provider needs from the trading service. */
export interface TradingSearchPort {
  listConnections(): Promise<TradingSearchConnection[]>
  listMarkets(connectionId: string): Promise<TradingSearchMarket[]>
}

/** Cap the markets surfaced per connection so one venue's thousands of pairs can't flood. */
const MAX_MARKET_HITS = 25

/**
 * What a market hit says under its symbol — everything the symbol does NOT already say.
 *
 * It used to read `<connection> · BASE/QUOTE`, which for a spot symbol spells the symbol back at
 * itself and, for the pair that matters, says nothing at all: `BTC/USDC` and `BTC/USDC:USDC` are a
 * spot buy and a leveraged one, and both subtitles read `BTC/USDC`. The operator is here for the
 * same reason it is on the picker row and the `localix://resource/trade` node — Hyperliquid lists `AAPL` four times,
 * once itself and once per builder dex, each with its own liquidity and liquidation risk, so a hit
 * with no distinguishing detail invites opening one and meaning another.
 *
 * An INACTIVE (delisted / halted) market is flagged for the same reason it is on every other surface:
 * a search hit that reads as tradable when a new order would be rejected is a claim about money.
 */
export function marketSubtitle(connectionName: string, m: TradingSearchMarket): string {
  const pair = `${m.base}/${m.quote}`
  const parts = [connectionName]
  if (m.symbol !== pair) parts.push(pair)
  parts.push(m.type)
  if (m.operator) parts.push(`by ${m.operator}`)
  if (m.active === false) parts.push('inactive')
  return parts.join(' · ')
}

export function createTradingSearchProvider(port: TradingSearchPort): SearchProvider {
  return {
    id: 'trading:search',
    title: 'Trading',
    tier: 'lazy',
    icon: 'trading',
    async search(_userId, query) {
      const conns = await port.listConnections().catch(() => [] as TradingSearchConnection[])
      const hits: SearchHit[] = []

      for (const c of conns) {
        const score = bestFieldScore([c.name, c.exchangeId], query.text)
        if (score > 0) {
          hits.push({
            id: buildTradeUri({ kind: 'connection', connectionId: c.id }),
            domain: 'trading:search',
            title: c.name,
            subtitle: `${c.exchangeId}${c.connected ? '' : ' · disconnected'}`,
            icon: 'trading',
            score,
          })
        }
      }

      // Markets only for CONNECTED venues (an enumeration needs a live driver); each
      // connection's fetch degrades to [] independently so one dead venue can't sink the rest.
      const connected = conns.filter((c) => c.connected)
      const marketGroups = await Promise.all(
        connected.map(async (c) => ({
          conn: c,
          markets: await port.listMarkets(c.id).catch(() => [] as TradingSearchMarket[]),
        })),
      )
      for (const { conn, markets } of marketGroups) {
        // Score EVERY market, then keep the best. Stopping at the first `MAX_MARKET_HITS` matches
        // truncated in the VENUE's order, which is not a ranking — on Hyperliquid the 299 spot
        // markets precede all 456 perpetuals, so a query matching both filled the quota with spot
        // and never scored the perp the user meant.
        const scored: SearchHit[] = []
        for (const m of markets) {
          const score = bestFieldScore([m.symbol, m.base, m.quote], query.text)
          if (score <= 0) continue
          scored.push({
            id: buildTradeUri({ kind: 'market', connectionId: conn.id, symbol: m.symbol }),
            domain: 'trading:search',
            title: m.symbol,
            subtitle: marketSubtitle(conn.name, m),
            icon: 'market',
            score,
          })
        }
        // Highest score first; ties broken by symbol so the cut is deterministic across calls.
        scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        hits.push(...scored.slice(0, MAX_MARKET_HITS))
      }

      return hits
    },
  }
}
