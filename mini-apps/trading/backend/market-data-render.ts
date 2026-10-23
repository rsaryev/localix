/**
 * The market_data tool's PRESENTATION layer — pure functions that turn port data into the
 * text block the model reads. No I/O, no port, no venue vocabulary: given the same numbers
 * they render the same lines, which is what makes them cheap to test.
 *
 * Lives apart from the tool so the orchestration (which reads) and the rendering (which
 * writes) can be understood — and changed — one at a time.
 */
import type {
  MarketDataBook,
  MarketDataCandle,
  MarketDataFunding,
  MarketDataMarket,
  MarketDataTicker,
} from './market-data-port'
import type { PrecisionMode } from './contracts'
import { contractNote, notionalOf, sizeUnit, withSizeUnit, type SizeUnitMarket } from './size-unit'
import { estimateSlippage } from './slippage'
import { formatCountdown } from './time-format'
import { estimateFee, feesLine, formatFeeRate } from './fees'
import { errText, isNotSupported, num } from './tool-text'

// The error/number text primitives are shared with the other trading tools and live in
// `tool-text.ts`. Re-exported here so `./market-data-render` stays the one import site its
// callers and tests already use.
export { errText, isNotSupported, num }

/**
 * What taking `size` would pay against the VISIBLE book, in the agent's words. The estimate is the
 * book as it stands, not a promise — and when the size outruns the depth we FETCHED, it is a lower
 * bound and says so, because a market order that eats past the last visible level pays more than any
 * number here. A `size` with no `side` is not an order: refuse rather than guess a direction.
 */
export function slippageLines(
  book: MarketDataBook,
  side: 'buy' | 'sell' | undefined,
  size: number,
  depth: number,
  unit: string,
  market: MarketDataMarket | undefined,
): string[] {
  if (side === undefined)
    return [
      '  (no slippage estimate: `size` needs a `side` — a buy walks the asks, a sell the bids)',
    ]
  const est = estimateSlippage(book, side, size)
  if (!est)
    return [
      `  (no slippage estimate: the ${side === 'buy' ? 'ask' : 'bid'} side of the book is empty)`,
    ]
  const worse = `${(est.slippage * 100).toFixed(3)}% worse than the ${side === 'buy' ? 'best ask' : 'best bid'} ${est.referencePrice}`
  const head = `  taking ${size}${unit} with a market ${side}: avg fill ${est.avgPrice.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}, ${worse}`
  // A market order pays the TAKER rate, on the notional it actually fills. An unvaluable market or
  // an unreported rate prints nothing rather than a comforting zero.
  const takerFee = estimateFee(notionalOf(est.filled, est.avgPrice, market), market?.fees?.taker)
  const feeLine =
    takerFee !== null
      ? [
          `  est. taker fee on the filled ${est.filled}${unit}: ${takerFee.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} ${market?.quote ?? ''} (${formatFeeRate(market?.fees?.taker)})`.trimEnd(),
        ]
      : []
  if (est.enoughDepth) return [head, ...feeLine]
  return [
    head,
    ...feeLine,
    `  Warning: the visible top-${depth} only fills ${est.filled}${unit} of ${size}${unit} — this is a LOWER BOUND on the real cost. Re-read with a larger \`depth\`, or split the order.`,
  ]
}

/**
 * One row of the basket quote: everything the venue reported about this symbol, and nothing it did
 * not.
 *
 * A symbol with no ticker gets a stated reason, never a `0` and never a blank that reads as a flat
 * market. `change` is a FRACTION on the wire (`0.0067`), rendered as a percent; it exists only where
 * the venue reports a genuine 24h datum, so a thin ticker simply shows no change rather than one
 * derived from a field that does not mean 24h. Volume NAMES ITS UNIT — base volume counts coins and
 * quote volume counts the quote currency, and on a cheap asset the two differ by orders of magnitude.
 */
export function quoteRow(
  symbol: string,
  t: MarketDataTicker | undefined,
  market?: SizeUnitMarket & { active?: boolean },
): string {
  // A delisted/halted market is not an opportunity — flag it so an agent SCANNING a basket does not
  // read a stale last price as a live one to trade. Only when the market is known to be inactive.
  const inactive = market?.active === false ? '  (inactive — delisted/halted)' : ''
  if (t?.last === undefined) return `${symbol}  (not priced in this read)${inactive}`
  // The QUOTE currency is in the unified symbol (`BASE/QUOTE[:SETTLE]`), so quote volume names its
  // unit for free. Base volume does NOT: ccxt's `baseVolume` is the venue's own count, and on a
  // contract market that is CONTRACTS (OKX's `vol24h`), so it is named from the MARKET or not at
  // all. `1234 BTC` beside a contract count overstates a day's turnover a hundredfold.
  const quote = symbol.split('/')[1]?.split(':')[0]
  const parts = [`${symbol}  last ${t.last}`]
  if (t.change !== undefined) {
    const pct = t.change * 100
    parts.push(`24h ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`)
  }
  if (t.baseVolume !== undefined)
    parts.push(`vol ${market ? withSizeUnit(String(t.baseVolume), market) : t.baseVolume}`)
  else if (t.quoteVolume !== undefined)
    parts.push(`quote vol ${t.quoteVolume}${quote ? ` ${quote}` : ''}`)
  return `${parts.join('   ')}${inactive}`
}

/**
 * How to read the `precision` numbers this venue REPORTS.
 *
 * Deliberately not a rounding law. A venue is free to round by a different rule than the one its
 * `precision` implies, and the priority venue does: Hyperliquid reports `precision.price = 1` for
 * BTC and still quotes `63982.5`, because it rounds prices to 5 significant digits rather than to
 * the tick it advertises. Teaching the agent "it steps by 1" makes it reject a live quote as
 * invalid, or hand-round a price the venue never asked it to round.
 *
 * The agent does not need the law at all: `manage_orders` rounds every price and size through the
 * venue's own methods before submitting. So say what the numbers mean, say who rounds, and stop.
 */
export function precisionModeNote(mode: PrecisionMode): string {
  switch (mode) {
    case 'tick':
      return 'reported as a TICK SIZE (a step, e.g. 0.01), not a decimal-place count'
    case 'decimals':
      return 'reported as a DECIMAL-PLACE COUNT (2 = two digits after the point)'
    case 'significant':
      return 'reported as a count of SIGNIFICANT DIGITS'
  }
}

/** The one sentence that keeps an agent from hand-rounding. Always printed beside the constraints. */
export const ROUNDING_NOTE =
  "    Send the price and size you mean: they are rounded through the exchange's own rules before submission. " +
  'A venue may round by a different rule than its reported precision implies.'

/**
 * A high/low over the candles we already fetched, for a venue whose ticker omits them.
 *
 * It is NOT labelled "24h": the window is whatever `candles × timeframe` the caller asked for, and
 * quietly calling a 30-hour range a 24-hour range is the kind of small lie an agent then reports
 * to a user as fact. The window is named in the label instead.
 */
export function derivedRange(candles: MarketDataCandle[], timeframe: string): string | null {
  if (candles.length === 0) return null
  let high = candles[0].high
  let low = candles[0].low
  for (const k of candles) {
    if (k.high > high) high = k.high
    if (k.low < low) low = k.low
  }
  return `  range over the last ${candles.length}×${timeframe}: H ${high} L ${low}`
}

// `candleSummary` + `trendLine` moved to the pure, shared `candle-lines.ts` (ONE renderer, reused by
// the `localix://resource/trade` candles leaf so a linked market never drifts from the tool). Imported above for use
// here; re-exported so existing importers and tests keep the same entry point.

/**
 * The constraints an order must satisfy BEFORE it is sent. Without them the agent guesses a size,
 * the venue (or the local risk gate) refuses it, and the recovery costs a round-trip against a
 * live exchange. `—` means the venue did not report the constraint, not that it is zero.
 */
/**
 * The funding line for a perpetual.
 *
 * The rate is stated PER ITS OWN INTERVAL and never annualised. Hyperliquid funds hourly at
 * `0.0000125`; the reflex "×3 for a day" (which assumes the common 8h period) overstates the daily
 * cost by 8×. When the venue does not name its interval we do not name one either — an unlabelled
 * rate is a rate the agent must ask about, not one it may extrapolate.
 */
export function fundingLine(f: MarketDataFunding, now: number): string {
  const pct = `${(f.rate * 100).toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}%`
  const per = f.interval
    ? ` per ${f.interval}`
    : " per the venue's funding period (interval not reported)"
  const side = f.rate > 0 ? 'longs pay shorts' : f.rate < 0 ? 'shorts pay longs' : 'no payment'
  // Absolute time AND a relative countdown: an ISO timestamp alone asks the agent whether funding is
  // imminent; the countdown answers it, the same figure the chart header shows.
  const countdown =
    f.nextFundingTime !== undefined ? formatCountdown(f.nextFundingTime - now) : null
  const next =
    f.nextFundingTime !== undefined
      ? `, next ${new Date(f.nextFundingTime).toISOString()}${countdown ? ` (in ${countdown})` : ''}`
      : ''
  const marks = [
    f.markPrice !== undefined ? `mark ${f.markPrice}` : undefined,
    f.indexPrice !== undefined ? `index ${f.indexPrice}` : undefined,
  ].filter(Boolean)
  const suffix = marks.length ? ` · ${marks.join(' · ')}` : ''
  return `  funding: ${pct}${per} (${side}${next}) — do NOT annualise it without the interval${suffix}`
}

/**
 * What ONE unit of size is WORTH, at a reference price — the line that stops the sizing mistake this
 * whole size-unit thread exists to prevent.
 *
 * An agent handed a free balance and a price sizes an order by dividing one by the other. On a
 * contract market that is wrong by `contractSize`: OKX's `BTC-USDT-SWAP` has `ctVal` 0.01, so
 * `10000 USDC / 64000` is 0.156 BTC — submitted as 0.156 CONTRACTS, a hundredth of what was meant
 * (and on an inverse contract the price does not enter the valuation at all). The human ticket has
 * `maxSizeAtOneX` for exactly this; the agent had nothing.
 *
 * `notionalOf` is the ONE valuation, shared with the risk gate. When it cannot value the market —
 * an unsized or unclassified contract — this says SO, and tells the agent not to fall back on
 * `balance / price`, rather than omitting the line and letting it do just that.
 */
export function unitCostLine(
  market: MarketDataMarket,
  lastPrice: number | undefined,
): string | null {
  if (lastPrice === undefined || !Number.isFinite(lastPrice) || lastPrice <= 0) return null
  const unit = sizeUnit(market)
  const perUnit = notionalOf(1, lastPrice, market)
  if (perUnit === undefined) {
    return `    one unit of size cannot be valued (the venue did not state this contract's size or linearity) — do NOT size by dividing a balance by the price`
  }
  const label = unit.label || 'unit'
  return `    1 ${label} ≈ ${perUnit.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} ${market.quote} at the last price — size a budget by DIVIDING it by this, never by the price`
}

export function orderConstraints(
  symbol: string,
  market: MarketDataMarket | undefined,
  mode: PrecisionMode,
  lastPrice?: number,
): string[] {
  if (!market) {
    // The ticker answered but the market roster did not list the symbol. Say so — silence here
    // reads as "no constraints", which is the one conclusion that gets an order rejected.
    return [
      `  (no market metadata for ${symbol} — order steps and minimums unknown; do not guess a size)`,
    ]
  }
  const unitCost = unitCostLine(market, lastPrice)
  return [
    // An INACTIVE market (delisted/halted) rejects a NEW order. Lead with it — the constraints
    // below are moot if nothing can be opened. A reduce-only close may still work.
    ...(!market.active
      ? [
          `  Inactive: ${symbol} is delisted or halted — a NEW order will be rejected; only a reduce-only CLOSE may work.`,
        ]
      : []),
    ...(market.operator
      ? [
          `  deployed by ${market.operator}, a third party — NOT the exchange itself. Its liquidity and` +
            ` liquidation risk are its own, and the same ticker may trade elsewhere on this venue under a` +
            ` different symbol. Trade the symbol you quoted.`,
        ]
      : []),
    `  order constraints — precision ${precisionModeNote(mode)}`,
    `    price precision ${num(market.precision.price)} · amount precision ${num(market.precision.amount)}`,
    `    min amount ${num(market.limits.minAmount)} · min cost ${num(market.limits.minCost)} · max leverage ${num(market.limits.maxLeverage)}`,
    // What the trade COSTS before it moves. An agent that cannot see the fee cannot compare a
    // strategy's edge against it, and silence here reads as "free".
    `    ${feesLine(market.fees)}`,
    // An amount without its unit is not a size. On a contract market every amount above — and every
    // amount `manage_orders` sends — is counted in contracts, not in the base currency.
    ...(contractNote(market) ? [`    ${contractNote(market)}`] : []),
    ...(unitCost ? [unitCost] : []),
    ROUNDING_NOTE,
  ]
}
