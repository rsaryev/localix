/**
 * ORDER-BOOK microstructure read — mined from the Vibe-Trading market-microstructure skill,
 * reduced to what ONE depth snapshot can honestly answer:
 *
 * - QUOTED SPREAD (`ask − bid`, as % of mid) — the cost of immediacy; a widening spread is the
 *   market-maker risk premium rising.
 * - DEPTH IMBALANCE over the top levels: `I = (Vbid − Vask) / (Vbid + Vask)` in [−1, 1]. The
 *   published finding (Cont, Kukanov & Stoikov 2014) is that book imbalance predicts the SHORT-
 *   horizon direction — more resting bid volume leans price up. It is a lean for the next ticks,
 *   not a level for a plan, and the render says so.
 *
 * VPIN / Kyle-lambda from the same skill need trade-flow history a snapshot does not carry —
 * deliberately not faked here. Pure — injected book, no I/O.
 */
import type { OrderBook } from '../contracts'

export interface OrderBookRead {
  /** Best bid / best ask midpoint. */
  mid: number
  /** Quoted spread as a percent of mid. */
  spreadPct: number
  /** (Vbid − Vask)/(Vbid + Vask) over the top `levels` — positive = bid-heavy (leans up). */
  imbalance: number
  /** MICROPRICE offset from mid, as a percent (Stoikov 2018): the imbalance-weighted fair value
   *  `bid·(Vask/ΣV) + ask·(Vbid/ΣV)` — heavy resting bids pull it toward the ask. Positive =
   *  above mid (the book's fair value leans up); a better one-tick predictor than the mid. */
  micropricePct: number
  /** How many levels per side actually fed the figures (min of requested and served). */
  levels: number
  state: 'bid_heavy' | 'balanced' | 'ask_heavy'
}

/** Top-of-book levels per side the imbalance sums — deep enough to matter, shallow enough to
 *  stay about the QUEUE at the touch rather than far-away decoration. */
const DEPTH_LEVELS = 10
/** |imbalance| above this reads as a one-sided book (the Cont-style short-horizon lean). */
const IMBALANCE_LEAN = 0.2

/** The snapshot read, or null when either side of the book is empty. */
export function orderBookRead(book: OrderBook | null | undefined): OrderBookRead | null {
  const bestBid = book?.bids[0]?.[0]
  const bestAsk = book?.asks[0]?.[0]
  if (!book || bestBid === undefined || bestAsk === undefined) return null
  if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) return null
  const mid = (bestBid + bestAsk) / 2
  const levels = Math.min(DEPTH_LEVELS, book.bids.length, book.asks.length)
  let vBid = 0
  let vAsk = 0
  for (let i = 0; i < levels; i++) {
    vBid += book.bids[i]?.[1] ?? 0
    vAsk += book.asks[i]?.[1] ?? 0
  }
  const total = vBid + vAsk
  if (!(total > 0)) return null
  const imbalance = (vBid - vAsk) / total
  // Microprice: the touch weighted by the OPPOSITE side's resting volume, so a heavy bid queue
  // (large vBid) pulls fair value toward the ask. Bounded within [bid, ask] by construction.
  const microprice = bestBid * (vAsk / total) + bestAsk * (vBid / total)
  return {
    mid,
    spreadPct: ((bestAsk - bestBid) / mid) * 100,
    imbalance,
    micropricePct: ((microprice - mid) / mid) * 100,
    levels,
    state:
      imbalance > IMBALANCE_LEAN
        ? 'bid_heavy'
        : imbalance < -IMBALANCE_LEAN
          ? 'ask_heavy'
          : 'balanced',
  }
}

/** The read as a report line — figures first, the honest scope note after. */
export function renderOrderBookRead(r: OrderBookRead): string[] {
  const lean =
    r.state === 'bid_heavy'
      ? `bid-heavy (${(r.imbalance * 100).toFixed(0)}% net) — resting demand leans the NEXT TICKS up`
      : r.state === 'ask_heavy'
        ? `ask-heavy (${(r.imbalance * 100).toFixed(0)}% net) — resting supply leans the NEXT TICKS down`
        : `balanced (${(r.imbalance * 100).toFixed(0)}% net)`
  // The microprice offset, when it is more than noise (a fraction of the spread).
  const micro =
    Math.abs(r.micropricePct) > r.spreadPct / 4
      ? ` microprice ${r.micropricePct >= 0 ? '+' : ''}${r.micropricePct.toFixed(4)}% vs mid (fair value leans ${r.micropricePct >= 0 ? 'up' : 'down'});`
      : ''
  return [
    `- order book (top ${r.levels}): spread ${r.spreadPct.toFixed(4)}% of mid,${micro} depth ${lean}. ` +
      'A microstructure lean for entry TIMING, not a level for the plan.',
  ]
}
