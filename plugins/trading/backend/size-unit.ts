/**
 * What ONE unit of `amount` is, on this market.
 *
 * Every amount the venue takes or reports — an order's size, a position's `contracts`,
 * `limits.minAmount` — is counted in the venue's own unit. On a spot market that is the base
 * currency. On a CONTRACT market it is contracts, and one contract is `contractSize` of the base.
 *
 * Hyperliquid sets `contractSize: 1`, so on the venue this workbench was built against the two
 * coincide and every surface could label a size `BTC` and be right. OKX's `BTC-USDT-SWAP` has
 * `ctVal` 0.01: a size of `5` is 0.05 BTC, and the same label overstates the position a
 * hundredfold — on the number a trader uses to decide whether they are over-exposed.
 *
 * So the label is derived, never assumed. A contract market whose size the venue did not state is
 * labelled `cont` too: we know the amount is not base units, we just cannot say how many.
 */
/** The market fields the unit depends on. STRUCTURAL, so the agent tool's narrowed market type
 *  (`market-data.ts`) fits without widening back to the full `contracts.ts` `Market`. */
export interface SizeUnitMarket {
  base: string
  contract: boolean
  contractSize?: number
  /** `true` linear (one contract = `contractSize` BASE), `false` inverse (= `contractSize` QUOTE). */
  linear?: boolean
}

export interface SizeUnit {
  /** Short label to put beside a number: the base currency, or `cont`. */
  label: string
  /** True when `label` is the base currency — a size that IS an amount of the asset. */
  isBase: boolean
  /** How much base ONE unit is worth, when that is knowable (spot ⇒ 1). */
  basePerUnit?: number
}

/** The unit of `amount` on `market`. A null market is unknown, not base. */
export function sizeUnit(market: SizeUnitMarket | null | undefined): SizeUnit {
  if (!market) return { label: '', isBase: false }
  if (!market.contract) return { label: market.base, isBase: true, basePerUnit: 1 }
  // A contract market whose size is exactly one base unit counts in base units, and saying `BTC`
  // there is not a rounding of the truth — it is the truth, and it is what a trader reads.
  if (market.contractSize === 1) return { label: market.base, isBase: true, basePerUnit: 1 }
  return { label: 'cont', isBase: false, basePerUnit: market.contractSize }
}

/**
 * A sentence explaining the contract, or `null` when there is nothing to explain (the size already
 * is an amount of the asset). Rendered as a hint under a size input and printed to the agent beside
 * the order constraints, because a minimum size means nothing without the unit it is counted in.
 */
export function contractNote(market: SizeUnitMarket | null | undefined): string | null {
  const unit = sizeUnit(market)
  if (!market || unit.isBase) return null
  return unit.basePerUnit !== undefined
    ? `Sizes are in CONTRACTS: 1 contract = ${unit.basePerUnit} ${market.base}.`
    : `Sizes are in CONTRACTS; the venue did not state how much ${market.base} one contract is.`
}

/** `12 BTC` / `12 cont` / bare `12` when the market (and so the unit) is unknown. */
export function withSizeUnit(text: string, market: SizeUnitMarket | null | undefined): string {
  const { label } = sizeUnit(market)
  return label ? `${text} ${label}` : text
}

/**
 * Header for a column of SIZES — an order book's depth, a trade tape's prints, a table of fills.
 * Every one of those numbers is counted in the venue's unit, so a bare `amount`/`size` column on a
 * contract market reads as an amount of the asset and is off by `contractSize`. Repeating the unit
 * on every ROW would be noise; naming it ONCE in the header is the whole fix.
 *
 * An unknown market names no unit rather than the wrong one — `size`, not `size (BTC)`.
 */
export function sizeColumn(name: string, market: SizeUnitMarket | null | undefined): string {
  const { label } = sizeUnit(market)
  return label ? `${name} (${label})` : name
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v)

/**
 * What `amount` units of this market are WORTH, in the quote currency, at `price` — or `undefined`
 * when that cannot be known.
 *
 * This is the one definition of an order's notional, shared by the risk gate (which refuses an
 * order past `maxOrderNotional`) and the ticket's "Order value" / estimated fee. `amount × price`
 * is only correct where one unit of amount is one unit of BASE:
 *
 * - spot, or a contract market with `contractSize: 1` (Hyperliquid) — `amount × price`
 * - LINEAR contract — one contract is `contractSize` base, so `amount × contractSize × price`
 * - INVERSE contract — one contract is `contractSize` QUOTE already, so `amount × contractSize`
 *   (the price does not enter; that is the point of an inverse contract)
 *
 * A contract market whose size or linearity the venue never stated returns `undefined`. The gate
 * turns that into a refusal under a notional cap, and the ticket hides the row. A guard-rail that
 * guesses at a hundredfold is not a guard-rail, and an "Order value" that is wrong by `contractSize`
 * is a number a trader would size real money against.
 */
export function notionalOf(
  amount: number,
  price: number | undefined,
  market: SizeUnitMarket | null | undefined,
): number | undefined {
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  if (!market) return undefined
  if (!market.contract) return finite(price) && price > 0 ? amount * price : undefined
  const size = market.contractSize
  if (!finite(size) || size <= 0) return undefined
  if (market.linear === false) return amount * size
  if (market.linear !== true) return undefined
  return finite(price) && price > 0 ? amount * size * price : undefined
}
