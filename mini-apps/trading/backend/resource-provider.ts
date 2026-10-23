/**
 * TRADING resource provider — a `ResourceRefProvider` (agent-core resource-refs) owning the
 * `localix://resource/trade` provider namespace. It is a sibling of the database / docker / git /
 * chat / k8s providers and turns the exchange workbench's read surface into a referenceable tree
 * the composer `@`-menu drills
 * (venue → market-type folder → market → market leaf; a credentialed connection keeps its
 * account category folders) and resolves a node to compact, INTROSPECTION-ONLY markdown, so a
 * user can drag a market (or its candles / order book) into chat, reach any of them via `@`, and
 * STOP at any level — every container is linkable through its action row.
 *
 * This file is the DISPATCHER only: it maps a parsed node to the one function that answers it.
 * The two answers live apart because they are two jobs — `resource-tree.ts` builds menu rows,
 * `resource-expand.ts` renders model-facing markdown — over the reads and display budgets they
 * must share, in `resource-shared.ts`.
 *
 * The `localix://resource/trade` grammar lives in the shared pure `uri.ts` leaf (also imported by the UI), so the
 * provider dispatches on a parsed {@link TradeUriNode} and never hand-splits a URI — a unified
 * symbol's `/` and `:` stay in one encoded segment.
 *
 * SECURITY: an expansion is built from public market data + the account read surface only. It
 * NEVER touches a connection's credentials — the narrow port exposes no credential value, so an
 * API key, secret, private key, wallet address or `${secret:}` token can never leak into
 * model-facing text.
 */
import { parseTradeUri } from './uri'
import type { ResourceExpansion, ResourceRefProvider } from '@localixai/mini-app-sdk/backend'
import { PROVIDER, connInfo, type ResourceTradingService } from './resource-shared'
import { connectionNodes, marketLeafNodes, marketNodes, marketsLevelNodes } from './resource-tree'
import {
  expandCandles,
  expandConnection,
  expandMarket,
  expandMarketFunding,
  expandMarketsListing,
  expandOrderBook,
  expandTechnicals,
  expandTicker,
  expandTrades,
} from './resource-expand'

export type { ResourceTradingService } from './resource-shared'

export function createTradingResourceProvider(
  service: ResourceTradingService,
): ResourceRefProvider {
  return {
    provider: PROVIDER,
    title: 'Trading',

    async listChildren(userId, parentUri, query) {
      if (parentUri === null) return connectionNodes(service, userId, query)
      const node = parseTradeUri(parentUri)
      if (!node) return []
      switch (node.kind) {
        case 'connection':
          // A venue goes straight to its markets (type folders): with no account surface there
          // is nothing else under it, so a single-child Markets level would be a click for
          // nothing.
          return marketsLevelNodes(service, userId, node.connectionId, query)
        case 'markets':
          return marketsLevelNodes(service, userId, node.connectionId, query)
        case 'marketType':
          return marketNodes(service, userId, node.connectionId, query, node.marketType)
        case 'market':
          return marketLeafNodes(service, userId, node.connectionId, node.symbol)
        // Account categories + every market leaf are terminal.
        case 'marketLeaf':
          return []
      }
    },

    async expand(userId, uri): Promise<ResourceExpansion> {
      const node = parseTradeUri(uri)
      if (!node) return { ok: false, error: 'That is not a trading resource.' }
      const conn = await connInfo(service, userId, node.connectionId)
      if (!conn) return { ok: false, error: 'No such trading connection.' }

      if (node.kind === 'connection') {
        const info = await service.describe(userId, node.connectionId).catch(() => null)
        return expandConnection(service, userId, conn, info)
      }
      if (!conn.connected)
        return { ok: false, error: 'The exchange connection is not open — connect it first.' }

      switch (node.kind) {
        case 'markets':
          return expandMarketsListing(service, userId, node.connectionId, conn.name)
        case 'marketType':
          return expandMarketsListing(
            service,
            userId,
            node.connectionId,
            conn.name,
            node.marketType,
          )
        case 'market':
          return expandMarket(service, userId, node.connectionId, node.symbol)
        case 'marketLeaf': {
          const { connectionId, symbol, leaf } = node
          // Exhaustive on the leaf token: a `default` that fell through to the ticker would
          // silently answer a NEW leaf with the wrong data instead of failing loudly.
          switch (leaf) {
            case 'ticker':
              return expandTicker(service, userId, connectionId, symbol)
            case 'candles':
              return expandCandles(service, userId, connectionId, symbol, node.timeframe)
            case 'orderbook':
              return expandOrderBook(service, userId, connectionId, symbol)
            case 'trades':
              return expandTrades(service, userId, connectionId, symbol)
            case 'funding':
              return expandMarketFunding(service, userId, connectionId, symbol)
            case 'technicals':
              return expandTechnicals(service, userId, connectionId, symbol, node.timeframe)
          }
          return { ok: false, error: `There is no "${String(leaf)}" view for a market.` }
        }
      }
    },
  }
}
