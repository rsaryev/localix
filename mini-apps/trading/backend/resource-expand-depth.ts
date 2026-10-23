/**
 * The candles / order-book / trade-tape expansions of the `localix://resource/trade` tree (`resource-expand.ts`
 * — see that module's header for the failed-read discipline these obey).
 */
import type { Candle, PublicTrade } from './contracts'
import { orderBookSpread } from './slippage'
import { candleSummary, trendLine } from './candle-lines'
import { sizeColumn } from './size-unit'
import type { ResourceExpansion } from '@localixai/mini-app-sdk/backend'
import {
  BOOK_DEPTH,
  CANDLE_BARS,
  TRADE_PRINTS,
  findMarket,
  failureSentence,
  type ResourceTradingService,
} from './resource-shared'
import { msStamp, num, stamp } from './resource-expand-quote'
import { DEFAULT_TIMEFRAME } from './timeframes'

export async function expandCandles(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
  timeframe = DEFAULT_TIMEFRAME,
): Promise<ResourceExpansion> {
  // A venue that could not be read did not report a market without history. Both refuse the
  // expansion, but only one of them is a fact about the market — say which.
  let candles: Candle[]
  try {
    candles = await service.ohlcv(userId, id, symbol, timeframe, { limit: CANDLE_BARS })
  } catch (err) {
    return { ok: false, error: failureSentence(err) }
  }
  if (candles.length === 0)
    return { ok: false, error: 'The venue returned no candles for this market.' }
  const shown = candles.slice(-CANDLE_BARS)
  const header =
    '| time (UTC) | open | high | low | close | volume |\n| --- | --- | --- | --- | --- | --- |'
  const rows = shown.map(
    (c) =>
      `| ${stamp(c.time)} | ${c.open} | ${c.high} | ${c.low} | ${c.close} | ${num(c.volume)} |`,
  )
  // Lead with the SAME window summary + MA20/MA50 trend the `market_data` tool prints (pure
  // `candle-lines`), so a linked market's candles read the same trend the agent reasons from and
  // the two can never drift. Price for the "vs MA20" note is the last close — the chart's last bar.
  const summary = candleSummary(shown, timeframe)
  const trend = trendLine(shown, shown[shown.length - 1]?.close)
  const lead = [summary, trend]
    .filter((l): l is string => l !== null)
    .map((l) => l.trimStart())
    .join('\n')
  const preamble = lead ? `${lead}\n\n` : ''
  return {
    ok: true,
    content: `Last ${rows.length} ${timeframe} candles for ${symbol}:\n${preamble}${header}\n${rows.join('\n')}`,
  }
}

export async function expandOrderBook(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
): Promise<ResourceExpansion> {
  const book = await service.orderBook(userId, id, symbol, BOOK_DEPTH).catch(() => null)
  if (!book) return { ok: false, error: 'The venue returned no order book for this market.' }
  // Book depth is counted in the VENUE's unit — contracts on a contract market. The header names
  // it once; a market we could not read names nothing rather than the base currency.
  const market = await findMarket(service, userId, id, symbol)
  const head = `| price | ${sizeColumn('amount', market)} |\n| --- | --- |`
  const bids = book.bids
    .slice(0, BOOK_DEPTH)
    .map(([p, a]) => `| ${p} | ${a} |`)
    .join('\n')
  const asks = book.asks
    .slice(0, BOOK_DEPTH)
    .map(([p, a]) => `| ${p} | ${a} |`)
    .join('\n')
  // The mid + spread up top, from the SAME `orderBookSpread` the tool and UI use — the reason to
  // link an order book at all is to read its tightness, so lead with it. Omitted when a side is empty.
  const s = orderBookSpread(book.bids, book.asks)
  const summary =
    s.mid !== null && s.spread !== null
      ? `Mid ${num(s.mid)} · spread ${num(s.spread)} (${s.spreadBps!.toFixed(1)} bps).\n\n`
      : ''
  return {
    ok: true,
    content: `Order book for ${symbol} (top ${BOOK_DEPTH}):\n\n${summary}**Bids**\n${head}\n${bids || '| — | — |'}\n\n**Asks**\n${head}\n${asks || '| — | — |'}`,
  }
}

export async function expandTrades(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
): Promise<ResourceExpansion> {
  // Some venues have no PUBLIC trade tape at all over REST (Hyperliquid's `fetchTrades` needs a
  // wallet and returns the caller's own trades). That refusal must not read as "nobody traded
  // BTC recently".
  let trades: PublicTrade[]
  try {
    trades = await service.trades(userId, id, symbol, TRADE_PRINTS)
  } catch (err) {
    return { ok: false, error: failureSentence(err) }
  }
  if (trades.length === 0)
    return { ok: true, content: `No trades reported for ${symbol} in the recent window.` }
  // Each print's size is in the venue's unit, exactly like the book's depth.
  const market = await findMarket(service, userId, id, symbol)
  const rows = trades
    .slice(-TRADE_PRINTS)
    .map(
      (t) =>
        `| ${t.timestamp === undefined ? '—' : msStamp(t.timestamp)} | ${t.side} | ${t.price} | ${t.amount} |`,
    )
    .join('\n')
  const head = `| time | side | price | ${sizeColumn('amount', market)} |\n| --- | --- | --- | --- |`
  return {
    ok: true,
    content: `Last ${Math.min(trades.length, TRADE_PRINTS)} trades for ${symbol}:\n${head}\n${rows}`,
  }
}
