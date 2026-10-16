/**
 * A perpetual's funding rate — the periodic payment between longs and shorts.
 *
 * `rate` is the fraction charged ONCE PER `interval`. It is NOT a daily or annual figure, and the
 * interval is venue-specific: Hyperliquid funds every `1h`, most venues every `8h`. Multiplying a
 * rate by three to "get the daily cost" is wrong on Hyperliquid by a factor of eight, so the
 * interval travels with the rate and nothing derives an annualised number from it.
 */
export interface FundingRate {
  symbol: string
  /** Fractional rate per `interval` (`0.0000125` = 0.00125% each period). Sign: positive means
   *  longs pay shorts. */
  rate: number
  /** The venue's funding period (`1h`, `8h`). Absent when unreported — never assume a default. */
  interval?: string
  markPrice?: number
  indexPrice?: number
  /** Unix ms of the settlement THIS `rate` applies to, when the venue reports it. Taken from
   *  ccxt's `fundingTimestamp` (NOT `nextFundingTimestamp`, which is the settlement after it and
   *  carries a different rate). */
  nextFundingTime?: number
}

/** Contracts outstanding in a derivative market. */
export interface OpenInterest {
  symbol: string
  /** Contracts outstanding, in the market's BASE units. */
  amount?: number
  /** Quote-currency value — reported by the venue only, NEVER derived from `amount × price`. */
  value?: number
  /** Unix ms. */
  timestamp?: number
}

/**
 * ONE settled funding payment on the account — the periodic cash a perpetual holder actually
 * paid or received. This is the fact `unrealizedPnl` hides: a leveraged position held for hours
 * can have its whole paper gain erased by funding, so a portfolio that shows PnL and not funding
 * is making a claim about money that is wrong.
 *
 * These are DATED SETTLEMENTS from the account's history, NOT an "accrued since entry" figure —
 * different facts, deliberately not conflated. (Accrued-since-entry exists on some venues only in
 * a venue-SPECIFIC position payload, which the agnostic port cannot read without special-casing a
 * venue; funding is therefore reported account-scoped, from this settlement history, not
 * per-position.)
 *
 * ⚠ SIGN — verified LIVE against Hyperliquid, 20/20 settlements cross-checked against position side
 * and the applied rate: `amount > 0` means the account **RECEIVED** funding (income); `amount < 0`
 * means it **PAID** funding (a cost). This is the OPPOSITE of {@link FundingRate.rate} (there a
 * positive rate means longs pay shorts) — a genuine trap, so the sign is stated, never inferred from
 * the rate. Net funding is the sum of amounts: a negative net is a net cost eating into PnL.
 */
export interface FundingPayment {
  symbol: string
  /** Quote-currency funding for this settlement. POSITIVE = received, NEGATIVE = paid (see above).
   *  A settlement whose amount the venue did not report is dropped entirely (like a fill with no
   *  price) — an unreadable amount is not a zero payment. */
  amount: number
  /** Settlement (quote) currency, when the venue reports it (Hyperliquid: `USDC`). */
  currency?: string
  /** The funding rate that applied at this settlement, when reported. Carried for context; the
   *  cash actually moved is `amount`, and the rate's sign follows the {@link FundingRate}
   *  convention, NOT `amount`'s. */
  rate?: number
  /** Unix ms of the settlement. */
  timestamp?: number
}
