/**
 * The `market_data` tool's browse modes: the connection roster (no connection_id), the basket
 * quote (`symbols`) and the exchange-capability report (connection_id alone). The one-market
 * deep quote lives in `market-data-symbol.ts`; the tool itself routes in `market-data.ts`.
 */
import type {
  MarketDataCaps,
  MarketDataConnection,
  MarketDataMarket,
  MarketDataTicker,
  MarketDataToolOptions,
} from './market-data-port'
import { supportedCapabilities } from './market-data-port'
import { errText, isNotSupported, precisionModeNote, quoteRow } from './market-data-render'
import { MAX_MARKETS, type MarketDataDetails, type MarketDataResult } from './market-data-schema'

type MarketDataPortLike = MarketDataToolOptions['port']

/** Mode 1: the connection roster (no `connection_id`). */
export function connectionRoster(conns: MarketDataConnection[]): MarketDataResult {
  // An empty roster is an answer, not a failed call: the call was right, and the list is empty.
  if (conns.length === 0) {
    return {
      content:
        'No trading connection is configured. Ask the user to add one in the Trading workbench first.',
    }
  }
  const lines = conns.map(
    (c) =>
      `- ${c.name} [${c.exchangeId}]${c.sandbox ? ' (sandbox)' : ''}${c.readonly ? ' · read-only' : ' · armed'}${c.connected ? '' : ' · disconnected'} — id: ${c.id}`,
  )
  const details: MarketDataDetails = {
    connections: conns.map((c) => ({ id: c.id, name: c.name, exchange: c.exchangeId })),
  }
  return {
    content: `${conns.length} trading connection(s):\n${lines.join('\n')}\n\nPass a connection_id to inspect one.`,
    details,
  }
}

/** Mode 2b: quote a basket of symbols in one bounded venue read. */
export async function quoteBasket(
  port: MarketDataPortLike,
  target: MarketDataConnection,
  wanted: string[],
): Promise<MarketDataResult> {
  if (!port.tickers) {
    return {
      content: `"${target.name}" cannot price several markets in one read. Call market_data once per symbol instead.`,
      isError: true,
    }
  }
  let quotes: MarketDataTicker[]
  try {
    quotes = await port.tickers(target.id, wanted)
  } catch (err) {
    // A venue that cannot quote in bulk is not a venue with no prices. Say which it is, and
    // point at the read that does work — otherwise the agent concludes the markets are dead.
    if (isNotSupported(err)) {
      return {
        content: `"${target.name}" cannot quote several markets in one read (${errText(err)}). Call market_data once per symbol instead.`,
        isError: true,
      }
    }
    return {
      content: `Could not quote markets on "${target.name}": ${errText(err)}`,
      isError: true,
    }
  }
  const bySymbol = new Map(quotes.map((t) => [t.symbol, t]))
  // Best-effort: the markets only name the volume's unit. A failed read names none.
  const marketList = await port.markets(target.id).catch(() => [] as MarketDataMarket[])
  const marketBySymbol = new Map(marketList.map((m) => [m.symbol, m]))
  const rows = wanted.map(
    (symbol) => `  ${quoteRow(symbol, bySymbol.get(symbol), marketBySymbol.get(symbol))}`,
  )
  const unpriced = wanted.filter((s) => !bySymbol.has(s))
  const lines = [`${wanted.length} market(s) on ${target.name} [${target.exchangeId}]:`, ...rows]
  if (unpriced.length) {
    // Never let an absent price read as a dead market. It means this read could not reach it.
    lines.push(
      '',
      `No price came back for ${unpriced.join(', ')} — the venue does not list the symbol, or it could not be ` +
        'priced in this read. It does NOT mean the price is zero. Pass one as `symbol` for a full quote.',
    )
  }
  const details: MarketDataDetails = { connection: target.name, exchange: target.exchangeId }
  return { content: lines.join('\n'), details }
}

/** Mode 2: exchange capabilities + market list (connection_id with no symbol). */
export async function describeExchange(
  port: MarketDataPortLike,
  target: MarketDataConnection,
): Promise<MarketDataResult> {
  let caps: MarketDataCaps
  try {
    caps = await port.describe(target.id)
  } catch (err) {
    return { content: `Could not describe "${target.name}": ${errText(err)}`, isError: true }
  }
  // A failed listing must not sink the capability report — but it must not vanish either. An
  // omitted market section reads as "this venue has nothing to browse", which is a claim about
  // the venue; the read simply did not come back. Only a genuine empty list says the venue lists
  // no markets.
  let markets: MarketDataMarket[] = []
  let marketsError: string | undefined
  try {
    markets = await port.markets(target.id)
  } catch (err) {
    marketsError = errText(err)
  }

  const on = supportedCapabilities(caps.capabilities)
  const shown = markets.slice(0, MAX_MARKETS)
  const mLines = shown.map(
    (m) =>
      `  ${m.symbol} [${m.type}]${m.operator ? ` · deployed by ${m.operator}` : ''}${m.active ? '' : ' (inactive)'}`,
  )
  const more =
    markets.length > shown.length
      ? `\n  … ${markets.length - shown.length} more markets (pass a symbol to quote one).`
      : ''
  const details: MarketDataDetails = { connection: target.name, exchange: target.exchangeId }
  const parts = [
    `${caps.name} [${target.exchangeId}]${target.sandbox ? ' (sandbox)' : ''}`,
    `  timeframes: ${caps.timeframes.join(', ') || '(none)'}`,
    `  supports: ${on.join(', ')}`,
    `  precision ${precisionModeNote(caps.precisionMode)}`,
  ]
  if (marketsError)
    parts.push(
      `\n(market listing unavailable: ${marketsError} — the capabilities above still hold)`,
    )
  else if (markets.length) parts.push(`\n${markets.length} market(s):`, mLines.join('\n') + more)
  else parts.push('\nThe venue reported no markets.')
  parts.push('\nPass a symbol to get a live ticker, candles and top-of-book.')
  return { content: parts.join('\n'), details }
}
