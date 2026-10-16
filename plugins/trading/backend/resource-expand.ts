/**
 * The `localix://resource/trade` EXPANSIONS — a node resolved to compact, INTROSPECTION-ONLY markdown, and
 * nothing else. The tree these nodes come from lives in `resource-tree.ts`.
 *
 * The rule every function here obeys: a read that THREW is not a read that returned nothing.
 * `catch(() => [])` would turn an unreachable venue into "No open positions", which an agent
 * reports to a user as "nothing is at risk". So a failed read is NAMED (`ok: false` with the
 * reason), and only a genuine empty array says the account is empty. Emptiness is a claim about
 * money; we only make it when we actually know it.
 *
 * These renderers deliberately reuse the SAME pure helpers the `market_data` / `portfolio` tools
 * print through (`feesLine`, `orderBookSpread`, `candle-lines`, `account-tables`, `size-unit`),
 * so a linked resource and the tool that reasons over it can never drift into stating different
 * numbers for one market.
 *
 * The expansions live in sibling modules by subject — quote/carry leaves in
 * `resource-expand-quote.ts`, connection/market/roster in `resource-expand-market.ts`,
 * and candles/book/tape in `resource-expand-depth.ts` — re-exported here so
 * `./resource-expand` stays the one entry point its importers and tests use.
 */
export { expandMarketFunding, expandTicker, oneLineTicker } from './resource-expand-quote'
export { expandConnection, expandMarket, expandMarketsListing } from './resource-expand-market'
export { expandCandles, expandOrderBook, expandTrades } from './resource-expand-depth'
export { expandTechnicals } from './resource-expand-technicals'
