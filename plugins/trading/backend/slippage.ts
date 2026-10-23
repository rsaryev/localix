import type { OrderBookLevel, OrderSide } from './contracts'

/**
 * PURE order-book walk: what a MARKET order of a given size would actually pay against the book as
 * it stands. Lives in `backend/` because BOTH consumers need it and neither may import the other:
 * the order ticket shows the estimate before a human submits, and the `market_data` tool shows it
 * before an AGENT does. A slippage estimate that disagreed between the two would be worse than
 * none — the agent would recommend a size the ticket then priced differently.
 *
 * Nothing here invents a number: an empty book side gives `null`, never `0%`. Sizes are in the
 * VENUE's unit (contracts on a contract market), exactly like the book's own amounts.
 */

export interface SlippageEstimate {
  /** Volume-weighted average fill price over the book levels consumed. */
  avgPrice: number
  /** Top-of-book reference — best ask for a buy, best bid for a sell. */
  referencePrice: number
  /** Fraction WORSE than the reference, always `>= 0` (`0.001` = 0.1%). */
  slippage: number
  /** How much of `size` the VISIBLE book could actually fill, in the venue's unit. */
  filled: number
  /** `false` when `size` exceeds the visible depth — the estimate is then a LOWER BOUND. */
  enoughDepth: boolean
}

/**
 * Estimate the slippage of TAKING `size` against the CURRENT book: a buy walks the asks up from the
 * best ask, a sell walks the bids down from the best bid, and the estimate is the volume-weighted
 * fill price versus the top of book.
 *
 * This is an estimate of the book AS IT STANDS, not a promise of what the venue will fill — the
 * caller labels it an estimate, and the confirm step previews the real order through the driver. It
 * is meaningful for a market order (which takes liquidity now); a resting limit order has no
 * slippage, so the ticket only shows this for a market order.
 *
 * `null` when the relevant side is empty (no reference price ⇒ no estimate — never a fabricated 0%).
 */
export interface BookSpread {
  /** Highest bid, or `null` if the bid side is empty. */
  bestBid: number | null
  /** Lowest ask, or `null` if the ask side is empty. */
  bestAsk: number | null
  /** Mid price `(bestBid + bestAsk) / 2`, `null` unless BOTH sides have a level. */
  mid: number | null
  /** Absolute `bestAsk − bestBid`, `null` unless both sides have a level. */
  spread: number | null
  /** Spread in basis points of the mid (`10000 × spread / mid`), `null` unless mid > 0. */
  spreadBps: number | null
}

/**
 * PURE top-of-book metrics: best bid/ask, mid, and the spread (absolute + basis points). Shared by
 * the `market_data` tool (so the agent reads the same liquidity signal the human sees) and the UI
 * order-book view — a wide spread means an illiquid market where a market order pays dearly, and both
 * surfaces must read it identically. Defensively re-sorts so it is correct whatever level order it is
 * handed. Never fabricates: an empty side ⇒ `null`, never a `0` that reads as a tight book.
 */
export function orderBookSpread(
  bids: readonly OrderBookLevel[],
  asks: readonly OrderBookLevel[],
): BookSpread {
  const bestBid = bids.length ? Math.max(...bids.map((l) => l[0])) : null
  const bestAsk = asks.length ? Math.min(...asks.map((l) => l[0])) : null
  const hasBoth =
    bestBid != null && bestAsk != null && Number.isFinite(bestBid) && Number.isFinite(bestAsk)
  const mid = hasBoth ? (bestBid + bestAsk) / 2 : null
  const spread = hasBoth ? bestAsk - bestBid : null
  const spreadBps = mid != null && spread != null && mid > 0 ? (spread / mid) * 10000 : null
  return { bestBid, bestAsk, mid, spread, spreadBps }
}

/**
 * Does a LIMIT order at `price` CROSS the book — i.e. fill immediately as a taker rather than rest as
 * a maker? A buy priced at or above the best ask takes it; a sell at or below the best bid takes it.
 *
 * This decides which FEE a limit order actually pays: quoting the maker rate on a marketable limit
 * understates the cost, since the venue fills it as a taker. Shared by the agent's approval card and
 * the order ticket so both price the same order identically. `null` when the relevant side is empty
 * (the crossing cannot be judged) or the price is not a finite positive number.
 */
export interface DepthTotals {
  /** Summed bid size over the counted levels, in the venue's unit. */
  bidSize: number
  /** Summed ask size over the counted levels, in the venue's unit. */
  askSize: number
  /** `bidSize / (bidSize + askSize)`, 0..1 — the share of visible depth that is bids. `> 0.5` = more
   *  resting buy interest (buy pressure). `null` when neither side has usable size. */
  bidShare: number | null
}

/**
 * The resting SIZE on each side of the book over the top `depth` levels — a coarse liquidity-pressure
 * read (order-book imbalance). Both sides are in the venue's OWN unit, so the comparison is
 * apples-to-apples. This is the VISIBLE book only, and is only meaningful when scoped to a stated
 * depth — the caller names the depth. Only finite positive sizes count; a side with none contributes
 * `0`, and an all-empty book yields a `null` share rather than a fabricated `0.5`.
 */
export function depthTotals(
  bids: readonly OrderBookLevel[],
  asks: readonly OrderBookLevel[],
  depth: number,
): DepthTotals {
  const sideSize = (levels: readonly OrderBookLevel[]): number => {
    let sum = 0
    for (const [, amount] of levels.slice(0, depth)) {
      if (Number.isFinite(amount) && amount > 0) sum += amount
    }
    return sum
  }
  const bidSize = sideSize(bids)
  const askSize = sideSize(asks)
  const total = bidSize + askSize
  return { bidSize, askSize, bidShare: total > 0 ? bidSize / total : null }
}

export function estimateSlippage(
  book: { bids: readonly OrderBookLevel[]; asks: readonly OrderBookLevel[] },
  side: OrderSide,
  size: number,
): SlippageEstimate | null {
  const levels = side === 'buy' ? book.asks : book.bids
  if (levels.length === 0 || !Number.isFinite(size) || size <= 0) return null
  const referencePrice = levels[0][0]
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return null

  let remaining = size
  let cost = 0
  let filled = 0
  for (const [price, amount] of levels) {
    if (remaining <= 0) break
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) continue
    const take = Math.min(remaining, amount)
    cost += take * price
    filled += take
    remaining -= take
  }
  if (filled <= 0) return null

  const avgPrice = cost / filled
  const raw =
    side === 'buy'
      ? (avgPrice - referencePrice) / referencePrice
      : (referencePrice - avgPrice) / referencePrice
  return {
    avgPrice,
    referencePrice,
    slippage: Math.max(0, raw),
    filled,
    enoughDepth: remaining <= 0,
  }
}
