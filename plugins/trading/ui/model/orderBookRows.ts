import type { OrderBookLevel } from '../../backend/contracts'
import { orderBookSpread, depthTotals } from '../../backend/slippage'

/**
 * Pure order-book shaping. Turns raw `[price, amount]` bid/ask levels into rows carrying
 * a running CUMULATIVE size and a 0..1 depth RATIO (the width of the background depth
 * bar), and derives the mid price + spread (absolute and in basis points). Both sides
 * share one ratio scale (the larger side's final cumulative) so the bars are visually
 * comparable. Pure so the tab stays a thin render and the maths is unit-tested.
 */

export interface DepthRow {
  price: number
  amount: number
  /** Running sum of `amount` from the best level to this one. */
  total: number
  /** `total` normalised to 0..1 against the deeper side, for the depth bar width. */
  ratio: number
}

export interface OrderBookView {
  /** Best (highest) bid first. */
  bids: DepthRow[]
  /** Best (lowest) ask first. */
  asks: DepthRow[]
  mid: number | null
  /** Absolute ask−bid spread. */
  spread: number | null
  /** Spread in basis points of the mid (10000 × spread / mid). */
  spreadBps: number | null
  /** Share of the visible depth that is bids (0..1), for the buy/sell-pressure bar. `null` when the
   *  shown book has no usable size on either side. */
  bidShare: number | null
}

/** Sum amounts into cumulative rows (levels already ordered best-first). */
function cumulate(levels: OrderBookLevel[], depth: number): Array<Omit<DepthRow, 'ratio'>> {
  const rows: Array<Omit<DepthRow, 'ratio'>> = []
  let running = 0
  for (const [price, amount] of levels.slice(0, depth)) {
    running += amount
    rows.push({ price, amount, total: running })
  }
  return rows
}

export function buildOrderBook(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  depth = 15,
): OrderBookView {
  // Defensive re-sort: bids best = highest price, asks best = lowest price.
  const sortedBids = [...bids].sort((a, b) => b[0] - a[0])
  const sortedAsks = [...asks].sort((a, b) => a[0] - b[0])

  const rawBids = cumulate(sortedBids, depth)
  const rawAsks = cumulate(sortedAsks, depth)

  const maxTotal = Math.max(rawBids.at(-1)?.total ?? 0, rawAsks.at(-1)?.total ?? 0, 1)
  const withRatio = (rows: Array<Omit<DepthRow, 'ratio'>>): DepthRow[] =>
    rows.map((r) => ({ ...r, ratio: Math.min(1, r.total / maxTotal) }))

  // Mid + spread come from the SAME pure metric the market_data tool reads, so the human order book
  // and the agent never disagree on how tight this market is.
  const { mid, spread, spreadBps } = orderBookSpread(sortedBids, sortedAsks)
  // Buy/sell pressure over the SAME visible depth the rows show — the pure `depthTotals` the agent reads.
  const { bidShare } = depthTotals(sortedBids, sortedAsks, depth)

  return { bids: withRatio(rawBids), asks: withRatio(rawAsks), mid, spread, spreadBps, bidShare }
}
