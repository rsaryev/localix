/**
 * Instrument metadata + contract carry normalizers: markets, funding rates, open interest and
 * settled funding payments. Pure — see `normalize.ts` for the module-family discipline
 * (untrusted input, nothing throws, a missing required field drops the entry).
 */
import type { FundingPayment, FundingRate, Market, MarketType, OpenInterest } from './contracts'
import { num, str } from './normalize-scalars'

const MARKET_TYPES = new Set<MarketType>(['spot', 'swap', 'future', 'margin', 'option'])
function marketType(v: unknown, contract: boolean): MarketType {
  const s = str(v)
  if (s && MARKET_TYPES.has(s as MarketType)) return s as MarketType
  return contract ? 'swap' : 'spot'
}

/**
 * The third party that deployed a market inside the exchange, or `undefined` when the exchange
 * itself lists it.
 *
 * Hyperliquid STATES it: a HIP-3 market carries `info.dex` (`'xyz'`) beside its `info.hip3` flag, and
 * ccxt.pro reads that same field to scope a builder subscription. A stated fact beats a parsed one,
 * so that is what this reports.
 *
 * The base's `<BUILDER>-<TICKER>` prefix is only a FALLBACK, for a venue or ccxt version that flags
 * the market without naming its dex. The FLAG is what licenses reading that prefix: a symbol alone
 * proves nothing (`ZM-USDC` is an ordinary market whose base is `ZM`, not a `ZM`-operated one), and
 * guessing an operator from a hyphen would tag real markets as third-party. It is also lossy — a
 * token whose own name carries a hyphen would hand back the wrong half.
 *
 * A venue that reports no such flag has no operator, and this returns `undefined` — never a guess.
 */
function operatorOf(m: Record<string, unknown>, base: string): string | undefined {
  const info = m.info
  if (!info || typeof info !== 'object') return undefined
  const dict = info as Record<string, unknown>
  if (dict.hip3 !== true) return undefined
  if (typeof dict.dex === 'string' && dict.dex) return dict.dex
  const prefix = base.split('-')[0]
  return prefix && prefix !== base ? prefix : undefined
}

export function normalizeMarket(raw: unknown): Market | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const symbol = str(m.symbol)
  const base = str(m.base)
  const quote = str(m.quote)
  if (!symbol || !base || !quote) return null

  const contract = m.contract === true
  const precision = (m.precision ?? {}) as Record<string, unknown>
  const limits = (m.limits ?? {}) as Record<string, Record<string, unknown> | undefined>

  // ccxt exposes each market's fee rates as top-level `maker`/`taker` fractions. A rate the venue
  // did not report stays UNDEFINED — never coerced to 0, which would read as a free trade.
  const maker = num(m.maker)
  const taker = num(m.taker)

  return {
    symbol,
    base,
    quote,
    type: marketType(m.type, contract),
    // ccxt uses `active !== false` semantics: an omitted flag means tradable.
    active: m.active !== false,
    contract,
    // Only meaningful on a contract market, and only when the venue states it. `1` is carried
    // explicitly (Hyperliquid says `1`) — it is an ANSWER, distinct from a venue that never said.
    ...(contract && num(m.contractSize) !== undefined ? { contractSize: num(m.contractSize) } : {}),
    // ccxt sets `linear`/`inverse` on contract markets only. A market it did not classify carries
    // neither — and an order on it cannot be valued, which the notional gate treats as a refusal.
    ...(contract && typeof m.linear === 'boolean' ? { linear: m.linear } : {}),
    precision: { price: num(precision.price), amount: num(precision.amount) },
    ...(operatorOf(m, base) ? { operator: operatorOf(m, base) } : {}),
    limits: {
      minAmount: num(limits.amount?.min),
      minCost: num(limits.cost?.min),
      maxLeverage: num(limits.leverage?.max),
    },
    // Omit the whole `fees` object when the venue reported neither rate, so a fee-less market carries
    // no `fees` key at all rather than `{ maker: undefined, taker: undefined }`.
    ...(maker !== undefined || taker !== undefined ? { fees: { maker, taker } } : {}),
  }
}

/**
 * ccxt `FundingRate` → our shape. The `interval` is carried VERBATIM: a rate means nothing without
 * the period it is charged over, and venues disagree (Hyperliquid `1h`, most others `8h`).
 * A rate that is not a finite number is no rate at all — never `0`, which reads as "free to hold".
 */
export function normalizeFundingRate(raw: unknown, fallbackSymbol?: string): FundingRate | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  const symbol = str(f.symbol) ?? fallbackSymbol
  const rate = num(f.fundingRate)
  if (!symbol || rate === undefined) return null
  return {
    symbol,
    rate,
    interval: str(f.interval),
    markPrice: num(f.markPrice),
    indexPrice: num(f.indexPrice),
    // ccxt's `fundingTimestamp` is WHEN THE RATE ABOVE SETTLES — every venue maps its own
    // "next funding time" onto it (binance `nextFundingTime`, bybit `nextFundingTime`, okx
    // `fundingTime`, hyperliquid the next top-of-hour). `nextFundingTimestamp` is the settlement
    // AFTER that one, carrying its own `nextFundingRate`; only a few venues report it (okx does).
    // Preferring it — as this line used to — counted down to a settlement one whole interval past
    // the rate on screen. The countdown must belong to the rate it sits beside.
    nextFundingTime: num(f.fundingTimestamp) ?? num(f.nextFundingTimestamp),
  }
}

/**
 * ccxt `OpenInterest` → our shape. `value` is taken only when the venue reports it. Deriving it as
 * `amount × price` would invent a quote figure the venue never stated, at whatever price we happened
 * to be holding.
 */
export function normalizeOpenInterest(raw: unknown, fallbackSymbol?: string): OpenInterest | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const symbol = str(o.symbol) ?? fallbackSymbol
  if (!symbol) return null
  const amount = num(o.openInterestAmount)
  const value = num(o.openInterestValue)
  if (amount === undefined && value === undefined) return null
  return { symbol, amount, value, timestamp: num(o.timestamp) }
}

/**
 * ccxt's "funding history structure" (`{ symbol, code, amount, rate, timestamp, … }`) → our shape.
 *
 * `amount` is the SETTLED cash and IS the payment — a settlement whose amount we cannot read tells
 * us nothing, so the whole entry drops out (`null`), exactly as `normalizeMyTrade` drops a fill with
 * no price. That is the "absent, never 0" discipline: we never invent a zero funding payment.
 *
 * The sign is carried VERBATIM from ccxt (positive = received, negative = paid — see
 * {@link FundingPayment}); nothing here flips it. `rate` is optional context only.
 */
export function normalizeFundingPayment(
  raw: unknown,
  fallbackSymbol?: string,
): FundingPayment | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  const symbol = str(f.symbol) ?? fallbackSymbol
  const amount = num(f.amount)
  if (!symbol || amount === undefined) return null
  return {
    symbol,
    amount,
    currency: str(f.code),
    rate: num(f.rate),
    timestamp: num(f.timestamp),
  }
}

/** Map + drop-unreadable a venue's funding-history array. Newest-last is preserved (ccxt sorts
 *  ascending by timestamp); the caller windows/reverses as it needs. */
export function normalizeFundingPayments(raw: unknown, fallbackSymbol?: string): FundingPayment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => normalizeFundingPayment(r, fallbackSymbol))
    .filter((f): f is FundingPayment => f !== null)
}
