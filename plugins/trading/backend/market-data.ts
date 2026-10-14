import { defineAgentTool } from '@localixai/agent/agents'
import type { MarketDataConnection, MarketDataToolOptions } from './market-data-port'
import { errText } from './market-data-render'
import { marketDataInputSchema } from './market-data-schema'
import { connectionRoster, describeExchange, quoteBasket } from './market-data-overview'
import { quoteSymbol } from './market-data-symbol'

// The port contract, the pure renderers, the input schema and the per-mode handlers live in
// their own modules (`market-data-port.ts` / `market-data-render.ts` / `market-data-schema.ts` /
// `market-data-overview.ts` / `market-data-symbol.ts`), leaving this file the tool itself: the
// connection pre-flights and the routing.
export * from './market-data-port'

/** Read live market data from the exchanges the user connected in the Trading workbench —
 *  READ-ONLY (no order placement/cancellation is reachable through this tool). */
export function createMarketDataTool(options: MarketDataToolOptions) {
  return defineAgentTool({
    name: 'market_data',
    activeVerb: 'Reading market data',
    description:
      'Read LIVE market data from the exchanges the user connected in the Trading workbench (READ-ONLY — it cannot ' +
      'place or cancel orders). Call with no arguments to list the connections. Pass connection_id to see that ' +
      'exchange, its capabilities and its markets. Add symbol (a UNIFIED symbol such as `BTC/USDC:USDC` or `ETH/USDT`) ' +
      'to get a live ticker, recent OHLCV candles (timeframe defaults to `1h`) and the top of the order book. Add ' +
      'indicators (e.g. ["ema:200","rsi:14","macd"]) to compute indicator values over those candles server-side — ' +
      'the same math the chart draws, no chart tab required (the fetched candles are the lookback window: ema:200 ' +
      'needs candles ≥ 200). Add size ' +
      '+ side to learn what a MARKET order of that size would pay: the average fill price walked off the visible book ' +
      'and how much worse it is than the top of book. Do this BEFORE placing a market order — a size larger than the ' +
      'visible depth reports a lower bound, not the real cost. The order-constraints block states what ONE unit ' +
      'of size is worth: size a budget by dividing it by that figure, NEVER by the price (on a contract market the ' +
      'two differ by the contract size). Pass ' +
      'symbols (a list) instead of symbol to quote several markets at once in one cheap read. Data is ' +
      'fetched live from the venue at call time. Reports a clear message when a connection is missing or the exchange ' +
      'is unreachable.',
    inputSchema: marketDataInputSchema,
    executionMode: 'parallel',
    // A live quote is a read; silence would classify it as `external` (an undeclared tool).
    mutates: false,
    async execute(_toolCallId, input) {
      let conns: MarketDataConnection[]
      try {
        conns = await options.port.listConnections()
      } catch (err) {
        return { content: `Trading is not available: ${errText(err)}`, isError: true }
      }

      // ── Mode 1: connection roster ───────────────────────────────────────
      if (!input.connection_id) return connectionRoster(conns)

      const target = conns.find((c) => c.id === input.connection_id)
      if (!target) {
        const opts = conns.map((c) => `${c.name} (${c.id})`).join(', ')
        return {
          content: `No trading connection with id "${input.connection_id}". Connections: ${opts || '(none)'}.`,
          isError: true,
        }
      }
      if (!target.connected) {
        return {
          content: `"${target.name}" is not connected. Ask the user to reconnect it in the Trading workbench.`,
          isError: true,
        }
      }

      // ── Mode 2b: quote a basket ─────────────────────────────────────────
      if (input.symbols && input.symbol) {
        return {
          content:
            'Pass either `symbol` (one market in depth: candles, book, funding) or `symbols` (a price quote for ' +
            'several), not both.',
          isError: true,
        }
      }
      if (input.symbols) return quoteBasket(options.port, target, input.symbols)

      // ── Mode 3: one market ──────────────────────────────────────────────
      if (input.symbol) return quoteSymbol(options.port, target, input.symbol, input)

      // ── Mode 2: exchange capabilities + market list ─────────────────────
      return describeExchange(options.port, target)
    },
  })
}
