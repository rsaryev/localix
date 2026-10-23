/**
 * The `market_data` tool's one-market deep quote (Mode 3): live ticker, order constraints,
 * funding/open interest, candles, top-of-book and the optional slippage estimate. The browse
 * modes live in `market-data-overview.ts`; the tool itself routes in `market-data.ts`.
 */
import { candleSummary, trendLine } from './candle-lines'
import { pairRead, renderPairRead } from './analysis/pair-read'
import { indicatorLines } from './indicator-values'
import { sizeUnit, withSizeUnit } from './size-unit'
import { depthTotals, orderBookSpread } from './slippage'
import type {
  MarketDataCandle,
  MarketDataConnection,
  MarketDataMarket,
  MarketDataTicker,
  MarketDataToolOptions,
} from './market-data-port'
import {
  derivedRange,
  errText,
  fundingLine,
  num,
  orderConstraints,
  slippageLines,
} from './market-data-render'
import {
  DEFAULT_CANDLES,
  type MarketDataDetails,
  type MarketDataInput,
  type MarketDataResult,
} from './market-data-schema'
import { DEFAULT_TIMEFRAME } from './timeframes'

/** Mode 3: one market in depth — quote, constraints, carry, candles, book, slippage. */
export async function quoteSymbol(
  port: MarketDataToolOptions['port'],
  target: MarketDataConnection,
  symbol: string,
  input: MarketDataInput,
): Promise<MarketDataResult> {
  const timeframe = input.timeframe ?? DEFAULT_TIMEFRAME
  const barCount = input.candles ?? DEFAULT_CANDLES
  const depth = input.depth ?? 10

  let ticker: MarketDataTicker
  try {
    ticker = await port.ticker(target.id, symbol)
  } catch (err) {
    return {
      content: `Could not read ${symbol} on "${target.name}": ${errText(err)}`,
      isError: true,
    }
  }
  // Candles are read BEFORE the summary line: a venue with a thin ticker (Hyperliquid
  // reports neither a 24h high/low nor a base volume) can still be given a real price range,
  // derived from the bars we are about to print anyway.
  let candles: MarketDataCandle[] = []
  let candlesError: string | undefined
  try {
    candles = await port.ohlcv(target.id, symbol, timeframe, barCount)
  } catch (err) {
    candlesError = errText(err)
  }

  // The market is read BEFORE the quote line, because the volume's unit comes from it.
  // Best-effort: it also feeds the order-constraints block below, and a metadata failure must
  // not sink the quote.
  let found: MarketDataMarket | undefined
  let marketsError: unknown
  try {
    found = (await port.markets(target.id, { query: symbol, limit: 50 })).find(
      (m) => m.symbol === symbol,
    )
  } catch (err) {
    marketsError = err
  }

  const chg = ticker.change === undefined ? '' : ` (${(ticker.change * 100).toFixed(2)}% 24h)`
  // A venue may report turnover in the base currency, the quote currency, or neither. Name
  // which one it is: `vol 1731990818` means nothing without the unit.
  const vol =
    ticker.baseVolume !== undefined
      ? `vol ${found ? withSizeUnit(String(ticker.baseVolume), found) : ticker.baseVolume}`
      : ticker.quoteVolume !== undefined
        ? `quote vol ${ticker.quoteVolume}`
        : 'vol —'
  const lines = [
    `${symbol} on "${target.name}" [${target.exchangeId}]`,
    `  last ${num(ticker.last)}${chg} · bid ${num(ticker.bid)} / ask ${num(ticker.ask)} · ${vol}`,
  ]
  if (ticker.high !== undefined || ticker.low !== undefined) {
    lines.push(`  24h H ${num(ticker.high)} L ${num(ticker.low)}`)
  } else {
    const derived = derivedRange(candles, timeframe)
    if (derived) lines.push(derived)
  }

  // What an order on THIS market must satisfy. Best-effort: a metadata failure must not
  // sink the quote, but a missing constraint block is better than a guessed size.
  try {
    if (marketsError) throw marketsError
    const caps = await port.describe(target.id)
    lines.push(...orderConstraints(symbol, found, caps.precisionMode, ticker.last))
  } catch (err) {
    lines.push(
      `  (order constraints unavailable: ${errText(err)} — do not guess a size; read them before placing)`,
    )
  }

  // Funding + open interest: what it COSTS to hold this contract, and how much is held.
  // Optional on the port, absent on spot, and a failure is reported — never rendered as
  // "no funding", which would read as "free to hold".
  if (port.fundingRate) {
    try {
      const f = await port.fundingRate(target.id, symbol)
      if (f) lines.push(fundingLine(f, Date.now()))
    } catch (err) {
      lines.push(`  (funding rate unavailable: ${errText(err)})`)
    }
  }
  if (port.openInterest) {
    try {
      const oi = await port.openInterest(target.id, symbol)
      if (oi) {
        const parts = [
          // `openInterestAmount` is in the venue's own unit — CONTRACTS on a contract market.
          oi.amount !== undefined
            ? found
              ? withSizeUnit(String(oi.amount), found)
              : String(oi.amount)
            : undefined,
          // Only the venue's own quote value — `amount × price` would invent one.
          oi.value !== undefined ? `${oi.value} ${found?.quote ?? 'quote'}` : undefined,
        ].filter(Boolean)
        if (parts.length) lines.push(`  open interest: ${parts.join(' · ')}`)
      }
    } catch (err) {
      lines.push(`  (open interest unavailable: ${errText(err)})`)
    }
  }

  if (candlesError !== undefined) {
    lines.push(`  (candles unavailable: ${candlesError})`)
    if (input.indicators?.length) {
      lines.push(
        '  (indicators not computed: they are derived from the candles, which failed to load)',
      )
    }
  } else if (candles.length) {
    const shown = candles.slice(-barCount)
    const summary = candleSummary(shown, timeframe)
    if (summary) lines.push(summary)
    const trend = trendLine(shown, ticker.last)
    if (trend) lines.push(trend)
    // Server-side indicator readings over the SAME window printed below — the agent gets the
    // chart's numbers without a mounted chart tab (see indicator-values.ts).
    if (input.indicators?.length) lines.push(...indicatorLines(input.indicators, shown, timeframe))
    const rows = shown.map(
      (k) =>
        `    ${new Date(k.time * 1000).toISOString().slice(0, 16).replace('T', ' ')}  O ${k.open}  H ${k.high}  L ${k.low}  C ${k.close}  V ${num(k.volume)}`,
    )
    lines.push(`  last ${rows.length} ${timeframe} candle(s):\n${rows.join('\n')}`)
  }

  // Top of book (best-effort), and — when the agent named a size and a side — what taking that
  // size would actually pay. Without this the agent submits a market order blind and learns the
  // cost from the fill; the human ticket has shown this estimate all along.
  try {
    const book = await port.orderBook(target.id, symbol, depth)
    const unit = found ? ` ${sizeUnit(found).label}` : ''
    const bids = book.bids
      .slice(0, depth)
      .map(([p, a]) => `${p} × ${a}`)
      .join(', ')
    const asks = book.asks
      .slice(0, depth)
      .map(([p, a]) => `${p} × ${a}`)
      .join(', ')
    lines.push(
      `  bids (price × size${unit}): ${bids || '(none)'}`,
      `  asks (price × size${unit}): ${asks || '(none)'}`,
    )
    const s = orderBookSpread(book.bids, book.asks)
    if (s.spread != null && s.mid != null) {
      // A wide spread is the cheapest liquidity signal there is: it is what a market order pays
      // just to cross, before any slippage. The human order book shows it; the agent needs it too.
      lines.push(`  spread: ${s.spread} (${s.spreadBps!.toFixed(1)} bps of mid ${s.mid})`)
    }
    // Resting size on each side of the visible book — a coarse buy/sell-pressure read (imbalance).
    const d = depthTotals(book.bids, book.asks, depth)
    if (d.bidShare !== null) {
      lines.push(
        `  depth (top ${depth}${unit}): bids ${num(d.bidSize)} · asks ${num(d.askSize)} — ${(d.bidShare * 100).toFixed(0)}% bids`,
      )
    }
    if (input.size !== undefined)
      lines.push(...slippageLines(book, input.side, input.size, depth, unit, found))
  } catch (err) {
    lines.push(`  (order book unavailable: ${errText(err)})`)
    if (input.size !== undefined)
      lines.push(
        '  (no slippage estimate: the order book could not be read — do NOT assume it is cheap)',
      )
  }

  // Pair analysis against another market on the same connection — needs its own wider window
  // (the mined 60-bar lookback + returns), read best-effort: a failed second leg degrades to a
  // stated line, never a failed quote.
  if (input.compare_with) {
    try {
      const PAIR_BARS = 90
      const [ownWide, other] = await Promise.all([
        candles.length >= PAIR_BARS
          ? Promise.resolve(candles)
          : port.ohlcv(target.id, symbol, timeframe, PAIR_BARS),
        port.ohlcv(target.id, input.compare_with, timeframe, PAIR_BARS),
      ])
      const pair = pairRead(ownWide, other)
      lines.push(
        ...(pair
          ? renderPairRead(symbol, input.compare_with, pair)
          : [
              `- pair vs ${input.compare_with}: not enough aligned ${timeframe} bars to say anything (needs 60+).`,
            ]),
      )
    } catch (err) {
      lines.push(`- pair vs ${input.compare_with}: unavailable (${errText(err)}).`)
    }
  }

  const details: MarketDataDetails = {
    connection: target.name,
    exchange: target.exchangeId,
    symbol,
    timeframe,
    candles: barCount,
  }
  return { content: lines.join('\n'), details }
}
