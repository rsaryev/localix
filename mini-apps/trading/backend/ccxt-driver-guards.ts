/**
 * Exported, structurally-typed guard helpers of the ccxt driver — each one is a rule the driver
 * must not get wrong, extracted so it is unit-testable offline (no ccxt, no network). The driver
 * (`ccxt-backend.ts`) composes these; nothing here holds driver state.
 */
import type { ExchangeInfo } from './contracts'
import { TradingError } from './errors'

/**
 * The mapped form of ccxt's LOCAL `ArgumentsRequired` refusal of a since-less OHLCV read
 * (`"coinbaseinternational fetchOHLCV() requires a since argument"`). Seen AFTER `run` maps the
 * raw throw, so it is a `TradingError('exchange_error')` whose MESSAGE carries ccxt's text
 * (the route surfaces it as `detail`). Exported for tests.
 */
export function requiresSinceError(err: unknown): boolean {
  return (
    err instanceof TradingError &&
    err.code === 'exchange_error' &&
    /requires a since argument/i.test(err.message)
  )
}

/** The minimal ccxt surface a public liveness read needs — declared structurally so the reachability
 *  logic is unit-testable with a fake exchange, no ccxt and no network. */
export interface PublicReachExchange {
  name: string
  has: Record<string, unknown>
  markets?: Record<string, unknown>
  fetchStatus(): Promise<unknown>
  fetchTime(): Promise<unknown>
  fetchOrderBook(symbol: string, limit?: number): Promise<unknown>
  fetchTicker(symbol: string): Promise<unknown>
}

/**
 * Make ONE genuine public call to prove the venue answers NOW — for a PUBLIC (credential-less)
 * connection whose market table was seeded from the disk cache, so `loadMarkets` never touched the
 * wire. Without this a warm cache would make "Test connection" / Save go green off a JSON file on
 * disk even when the venue is down (the `fakes-agree-with-broken-code` class, one layer out).
 *
 * Cheapest genuine read first, gated on the tri-state `has`: `fetchStatus` → `fetchTime` → an
 * order-book read on any loaded symbol (measured `l2Book` ~0.35s on Hyperliquid; preferred over
 * `fetchTicker`, which is `'emulated'` and expensive on some venues) → `fetchTicker` as a last
 * resort. A raw throw propagates (the caller maps it), so an unreachable venue FAILS the probe.
 *
 * When the venue offers NO public read at all, we THROW rather than award an unearned green — the
 * same discipline as `credentialsChecked: false`: a claim we cannot support is not made. (In
 * practice every real venue offers at least an order book; this branch guards the principle.)
 */
export async function attemptPublicReachRead(ex: PublicReachExchange): Promise<void> {
  const has = (m: string) => ex.has?.[m] === true || ex.has?.[m] === 'emulated'
  if (has('fetchStatus')) return void (await ex.fetchStatus())
  if (has('fetchTime')) return void (await ex.fetchTime())
  const symbol = Object.keys(ex.markets ?? {})[0]
  if (symbol && has('fetchOrderBook')) return void (await ex.fetchOrderBook(symbol))
  if (symbol && has('fetchTicker')) return void (await ex.fetchTicker(symbol))
  throw new TradingError(
    'exchange_error',
    `${ex.name} offers no public read to verify reachability — cannot confirm the venue is up.`,
  )
}

// `withAccountChangeNote` (a note about a `setLeverage`/`setMarginMode` write that survived a
// rejected order) and `nativeCancelAllCount` (a venue bulk-cancel, counted) lived here with ZERO
// callers and zero tests after `e550f0cb1` removed the order path. The second one still ISSUED
// `cancelAllOrders` — a live account write reachable from nothing, in a mini app that cannot
// authenticate. Both are gone; a future order surface brings back the helper WITH its caller.

/** Refuse up front when the venue does not implement the call — a clear typed error
 *  beats ccxt's generic NotSupported deep inside a request. Bound to one driver's `info`. */
export function requireCapFor(info: ExchangeInfo) {
  return (cap: keyof ExchangeInfo['capabilities'], label: string): void => {
    if (!info.capabilities[cap])
      throw new TradingError('not_supported', `${info.name} does not support ${label}.`)
  }
}
