import type { Market, MarketType } from './contracts'

/**
 * Which markets survive a cap, and in what order. Pure, and the SINGLE rule — the `localix://resource/trade`
 * resource provider (`@`-menu) and the sidebar both list a capped slice of the same roster, and
 * they must not disagree about which slice.
 *
 * A venue lists its markets in its own order, and that order is not a ranking. Hyperliquid returns
 * all 299 spot markets before the first of its 456 perpetuals, so `markets.slice(0, 200)` kept
 * ZERO perpetuals — the instrument the venue exists for. BTC's perp could not be reached from
 * either surface, while two hundred meme spot tokens could.
 *
 * So the cap is allocated per market TYPE rather than taken off the top: every type present gets a
 * fair share, leftover capacity is redistributed, and each type is ordered alphabetically so a
 * major symbol lands near the top of its group instead of at position 140. Inactive markets sort
 * behind active ones — they are listable, not tradable.
 *
 * Deliberately NOT venue-flavoured: no "perpetuals first", no symbol allow-list. On a spot-only
 * venue this changes only the alphabetisation.
 */

/** Fixed display order for the per-type groups. Also the tie-break between types. */
export const MARKET_TYPE_ORDER: MarketType[] = ['spot', 'swap', 'future', 'margin', 'option']

export interface RankedMarkets {
  /** The capped, ordered markets. */
  markets: Market[]
  /** How many were eligible before the cap. */
  total: number
  /** True when the cap dropped something — the caller MUST say so. */
  capped: boolean
}

/** Active first, then by unified symbol. Stable and total. */
function compare(a: Market, b: Market): number {
  if (a.active !== b.active) return a.active ? -1 : 1
  return a.symbol.localeCompare(b.symbol)
}

function typeRank(type: MarketType): number {
  const i = MARKET_TYPE_ORDER.indexOf(type)
  // A type the display order does not know sorts last rather than at position -1.
  return i === -1 ? MARKET_TYPE_ORDER.length : i
}

/**
 * Cap `markets`, giving each market type present an equal share of the budget before handing any
 * leftover to the types that still have entries. Order is type order, then {@link compare}.
 *
 * `cap <= 0` yields nothing (and reports `capped` when there was anything to drop).
 */
export function rankMarkets(markets: Market[], cap: number): RankedMarkets {
  const total = markets.length
  if (cap <= 0) return { markets: [], total, capped: total > 0 }

  const byType = new Map<MarketType, Market[]>()
  for (const m of markets) {
    const bucket = byType.get(m.type)
    if (bucket) bucket.push(m)
    else byType.set(m.type, [m])
  }
  for (const bucket of byType.values()) bucket.sort(compare)

  const types = [...byType.keys()].sort((a, b) => typeRank(a) - typeRank(b))
  const share = Math.ceil(cap / types.length)

  // Pass 1: a fair share of the budget to every type present.
  const taken = new Map<MarketType, number>()
  let budget = cap
  for (const type of types) {
    const bucket = byType.get(type) as Market[]
    const n = Math.min(share, bucket.length, budget)
    taken.set(type, n)
    budget -= n
  }
  // Pass 2: a type with fewer markets than its share leaves budget behind — give it to the rest.
  for (const type of types) {
    if (budget === 0) break
    const bucket = byType.get(type) as Market[]
    const already = taken.get(type) as number
    const more = Math.min(bucket.length - already, budget)
    taken.set(type, already + more)
    budget -= more
  }

  const out: Market[] = []
  for (const type of types)
    out.push(...(byType.get(type) as Market[]).slice(0, taken.get(type) as number))
  return { markets: out, total, capped: out.length < total }
}
