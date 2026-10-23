/**
 * PURE fee math. Lives in `backend/` for the same reason `slippage.ts` does: BOTH the order ticket
 * and the `market_data` tool quote the cost of a trade, and a fee the human sees but the agent does
 * not is a cost the agent will recommend the human into.
 *
 * A venue that reports no fee rate gives an UNKNOWN fee, never a free one. "Free" is a claim about
 * money, and this module makes no claim it was not given the data for.
 */

/** A venue's reported fee rates, as fractions (`0.00045` = 0.045%). Either side may be absent. */
export interface MarketFees {
  maker?: number
  taker?: number
}

/**
 * The fee an order valued at `notional` (quote currency) pays at `rate`. `null` when either is
 * unknown — the caller renders nothing rather than a zero.
 */
export function estimateFee(
  notional: number | null | undefined,
  rate: number | undefined,
): number | null {
  if (notional == null || rate === undefined) return null
  if (!Number.isFinite(notional) || !Number.isFinite(rate)) return null
  return notional * rate
}

/** `0.045%` — a rate as a percentage, trailing zeros trimmed. `null` rate ⇒ `null`. */
export function formatFeeRate(rate: number | undefined): string | null {
  if (rate === undefined || !Number.isFinite(rate)) return null
  return `${(rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`
}

/**
 * The fee line for the agent's order-constraints block. Names each side it KNOWS and says plainly
 * when the venue reported neither — an omitted line would read as "no fees on this market".
 */
export function feesLine(fees: MarketFees | undefined): string {
  const maker = formatFeeRate(fees?.maker)
  const taker = formatFeeRate(fees?.taker)
  if (maker === null && taker === null)
    return 'fees: the venue did not report them (do NOT assume this market is free to trade)'
  const parts: string[] = []
  parts.push(`maker ${maker ?? 'not reported'}`)
  parts.push(`taker ${taker ?? 'not reported'}`)
  // A market order pays the taker rate; a resting limit order pays maker only if it is not filled
  // on arrival. Saying which is which is what makes the number actionable.
  return `fees: ${parts.join(' · ')} (a market order pays taker)`
}
