import type { PublicTrade } from '../../backend/contracts'

/**
 * The aggressor imbalance over a set of prints — the share of executed VOLUME that lifted the ask
 * (buys) versus hit the bid (sells). Unlike order-book depth (resting intent), this is intent that
 * actually traded, so it reads real buying/selling pressure. Pure and null-honest: no volume, no
 * fabricated 50/50.
 */
export interface TradeFlow {
  /** Buy volume ÷ total volume, 0..1. */
  buyShare: number
  buyVolume: number
  sellVolume: number
}

export function tradeFlow(trades: readonly PublicTrade[]): TradeFlow | null {
  let buyVolume = 0
  let sellVolume = 0
  for (const t of trades) {
    if (t.side === 'buy') buyVolume += t.amount
    else if (t.side === 'sell') sellVolume += t.amount
  }
  const total = buyVolume + sellVolume
  if (!(total > 0)) return null
  return { buyShare: buyVolume / total, buyVolume, sellVolume }
}
