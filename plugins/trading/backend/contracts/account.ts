/**
 * Account + execution vocabulary — balances, positions, orders, and the create-order
 * request the risk gate validates.
 *
 * DORMANT: the account/execution backend is deliberately NOT registered on the public
 * market-data surface (see `index.ts`). This vocabulary is kept, and kept tested, so the
 * credentialed workbench can be turned back on without re-deriving it — but nothing on
 * the live route surface reads it today.
 */
import { z } from 'zod'

// ── Account ────────────────────────────────────────────────────────────────────

export interface BalanceEntry {
  currency: string
  /** Spendable right now. ABSENT when the venue reported the holding but not its free portion —
   *  which is NOT the same as none of it being free, and must never be rendered as `0`. */
  free?: number
  /** Locked as margin or in open orders. Absent for the same reason. */
  used?: number
  total: number
}

export interface Balance {
  entries: BalanceEntry[]
  /** Venue-reported account value in the quote currency, when it publishes one. */
  totalUsd?: number
}

export interface Position {
  symbol: string
  side: 'long' | 'short'
  contracts: number
  entryPrice?: number
  markPrice?: number
  /**
   * ABSENT does not mean "cannot be liquidated". A CROSS-margin position has no per-position
   * liquidation price — the whole account backs it — so venues report none. Verified live:
   * Hyperliquid returns `liquidationPx: null` for every cross position. Read it beside
   * {@link marginMode}, and never render a bare `—` as "safe".
   */
  liquidationPrice?: number
  leverage?: number
  /** Which margin backs the position. Explains an absent `liquidationPrice`. */
  marginMode?: MarginMode
  unrealizedPnl?: number
  notional?: number
  /**
   * The margin BACKING this position (ccxt `collateral` — Hyperliquid's `marginUsed`). The
   * denominator of the return-on-equity (ROE%) figure a trader actually watches: `uPnL / collateral`.
   * ccxt's own `percentage` field computes this but over the ABSOLUTE uPnL, so it loses the sign and
   * shows a loss as a gain — we carry the raw margin and compute the SIGNED return ourselves. ABSENT
   * when the venue does not report it; never inferred.
   */
  collateral?: number
}

export const orderSideSchema = z.enum(['buy', 'sell'])
export const orderTypeSchema = z.enum(['market', 'limit'])
export type OrderSide = z.infer<typeof orderSideSchema>
export type OrderType = z.infer<typeof orderTypeSchema>

export interface Order {
  id: string
  /**
   * OUR client order id, when one was minted at submission and the venue ECHOES it back.
   * This is the join key the journal reconciles a `pending` intent against — a venue order
   * carrying our id is proof the intent reached the venue. Absent on a venue that ignores it.
   */
  clientOrderId?: string
  symbol: string
  side: OrderSide
  type: OrderType
  /** Base-currency size. */
  amount: number
  price?: number
  /**
   * The price at which a stop / take-profit order ARMS. A trigger order carries no resting
   * `price` on some venues (a stop-market has none at all), so an order reported without this
   * field looks priceless — which is how a live stop-loss came to render as `@ market`. It is
   * the single most safety-relevant number an open order carries: it is where the position
   * stops losing. Sourced from whichever of ccxt's `triggerPrice`/`stopPrice`/
   * `takeProfitPrice`/`stopLossPrice` the venue populates.
   */
  triggerPrice?: number
  /**
   * How much of `amount` has executed. ABSENT when the venue did not report it — never `0`, which
   * says the order is untouched. A partially-filled stop-loss reported as `0 filled` tells the
   * reader the whole position is still protected by it.
   */
  filled?: number
  /** `amount - filled`, or the venue's own figure. ABSENT when neither is knowable — deriving it
   *  from an invented `filled: 0` would restate the same claim as a different number. */
  remaining?: number
  status: 'open' | 'closed' | 'canceled' | 'expired' | 'rejected' | 'unknown'
  /** Unix ms of placement. ABSENT when the venue did not stamp it. */
  timestamp?: number
  /** True when the order only reduces an existing position. */
  reduceOnly?: boolean
  /** True when the venue reports the order as maker-only (Hyperliquid's `ALO` tif). */
  postOnly?: boolean
  /** Venue-neutral time-in-force, when the venue reports one. */
  timeInForce?: TimeInForce
}

/** Time-in-force, venue-neutral: good-til-cancel / immediate-or-cancel / fill-or-kill /
 *  post-only. The driver maps these onto each venue's own vocabulary (and `po` onto the
 *  venue's post-only flag, NOT a literal `'po'` TIF string some venues reject). */
export const timeInForceSchema = z.enum(['gtc', 'ioc', 'fok', 'po'])
export type TimeInForce = z.infer<typeof timeInForceSchema>

/** Margin mode for a leveraged position — reported per venue (`capabilities.setMarginMode`). */
export const marginModeSchema = z.enum(['cross', 'isolated'])
export type MarginMode = z.infer<typeof marginModeSchema>

export const createOrderSchema = z
  .object({
    symbol: z.string().min(1),
    side: orderSideSchema,
    type: orderTypeSchema,
    amount: z.number().positive(),
    /** REQUIRED for `limit`. For `market` it is an optional slippage reference some
     *  on-chain venues (Hyperliquid) need to size their aggressive order — the driver sources
     *  it from the ticker when absent, since those venues REJECT a priceless market order. */
    price: z.number().positive().optional(),
    reduceOnly: z.boolean().optional(),
    // ── Optional, venue-NEUTRAL execution controls. Each is DROPPED by the driver (and the
    //    order REFUSED by the service) on a venue that does not report supporting it — the
    //    driver never silently omits a requested control. Mapping lives in `order-params.ts`.
    /** Time-in-force. `po` (post-only) is equivalent to `postOnly: true`. */
    timeInForce: timeInForceSchema.optional(),
    /** Never take liquidity — the order rests or is rejected. Meaningless on a `market` order. */
    postOnly: z.boolean().optional(),
    /** Turn the order into a trigger (stop) order that fires at this price. Needs
     *  `capabilities.triggerOrders`. */
    triggerPrice: z.number().positive().optional(),
    /** Attach a protective take-profit at this price. Lone tp/sl needs `capabilities.triggerOrders`;
     *  tp AND sl together need `capabilities.takeProfitStopLoss`. DIRECTION (tp above a buy entry,
     *  below a sell entry) is validated in `order-params.ts`, where the reference price is known —
     *  it cannot be checked here without one. */
    takeProfit: z.number().positive().optional(),
    /** Attach a protective stop-loss at this price. Direction is the mirror of `takeProfit`. */
    stopLoss: z.number().positive().optional(),
    /** Account-level leverage to set BEFORE the order (NOT an order field). Needs
     *  `capabilities.setLeverage`. */
    leverage: z.number().positive().optional(),
    /** Account-level margin mode to set BEFORE the order. Needs `capabilities.setMarginMode`. */
    marginMode: marginModeSchema.optional(),
    /** Passed through verbatim to the venue (e.g. `{ timeInForce: 'Ioc' }`). */
    params: z.record(z.string(), z.unknown()).optional(),
  })
  // A limit order without a price is not a limit order — refuse it here rather than letting
  // the venue reject it (or, worse, silently treat it as a market order). This ALSO covers a
  // `triggerPrice` with `type: 'limit'` (a trigger-limit still needs its limit price).
  .refine((o) => o.type !== 'limit' || o.price !== undefined, {
    message: 'A limit order requires a price.',
    path: ['price'],
  })
  // Post-only means "never take liquidity" — it only makes sense on a resting (limit) order.
  // `po` is the TIF spelling of the same thing, so it is refused on a market order too.
  .refine((o) => !((o.postOnly === true || o.timeInForce === 'po') && o.type === 'market'), {
    message: 'post-only is meaningless on a market order — a market order always takes liquidity.',
    path: ['postOnly'],
  })
  // Post-only ("never take") and IOC/FOK ("take now or die") are mutually exclusive intents.
  .refine((o) => !(o.postOnly === true && (o.timeInForce === 'ioc' || o.timeInForce === 'fok')), {
    message:
      'post-only cannot be combined with an immediate-or-cancel / fill-or-kill time-in-force.',
    path: ['timeInForce'],
  })
export type CreateOrderRequest = z.infer<typeof createOrderSchema>

/**
 * What the venue will ACTUALLY receive, after its own tick/lot rounding is applied to the
 * request. The submit path rounds anyway (`amountToPrecision`/`priceToPrecision`), so without a
 * preview a human approves one price and the venue executes another — and the approval card, the
 * journal notional and the success text all restate a number that was never sent.
 *
 * A MARKET order is previewed with no `price`: the driver sources the reference price from the
 * ticker at submit time. Saying "market" is honest; inventing a price here would not be.
 */
export interface OrderPreview {
  amount: number
  price?: number
  triggerPrice?: number
  takeProfit?: number
  stopLoss?: number
  /** True when any value differs from what was requested — the caller says so out loud. */
  rounded: boolean
}
