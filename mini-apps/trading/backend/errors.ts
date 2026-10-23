/**
 * Exchange-agnostic error mapping. Every venue (and every ccxt error class) throws its
 * own shape; the workbench needs a small, stable, typed vocabulary the UI can branch on
 * WITHOUT knowing anything about Hyperliquid vs Binance vs Bybit.
 *
 * The rule (identical to the database workbench's `mapDbError`): no exchange branching
 * leaks into the service or routes — every raw driver error goes through
 * {@link mapTradingError}, which pattern-matches the class name and the common phrases
 * the venues share, and collapses them into a {@link TradingErrorCode}.
 *
 * The typed-error SKELETON (the error class, `toErrorInfo`) is the shared
 * `defineTypedError` kit — four workbenches had hand-rolled it identically. What stays
 * here is the only part with domain content in it: the FRIENDLY sentences and
 * {@link mapTradingError}'s prototype-chain classification.
 *
 * NOTE: `mapTradingError` deliberately does NOT use `kit.rawOf`. It passes its raw text
 * to the constructor UNCONDITIONALLY (no `|| undefined`), so it needs `String(err)`
 * semantics — `kit.rawOf(null)` is `''`, which is not nullish and would therefore become
 * an EMPTY `message` instead of falling back to the friendly sentence.
 */

import { defineTypedError, type TypedDomainError } from '@localixai/mini-app-sdk/backend'

export type TradingErrorCode =
  | 'not_connected'
  | 'connection_not_found'
  | 'exchange_unknown'
  | 'auth_failed'
  | 'network_error'
  | 'rate_limit'
  | 'bad_symbol'
  | 'insufficient_funds'
  | 'invalid_order'
  | 'order_not_found'
  | 'not_supported'
  | 'readonly_blocked'
  | 'risk_blocked'
  | 'agent_trading_disabled'
  | 'halted'
  | 'exchange_error'

const FRIENDLY: Record<TradingErrorCode, string> = {
  not_connected: 'The exchange connection is not open — connect it first.',
  connection_not_found: 'No such trading connection.',
  exchange_unknown: 'That exchange is not supported by the installed driver.',
  auth_failed: 'The exchange rejected the credentials — check the API key / wallet signature.',
  network_error: 'Could not reach the exchange — check connectivity and that the venue is up.',
  rate_limit: 'The exchange rate-limited the request — slow down and retry.',
  bad_symbol: 'The exchange does not list that market symbol.',
  insufficient_funds: 'Insufficient balance for this order.',
  invalid_order: 'The exchange rejected the order — check size, price, and the market limits.',
  order_not_found: 'No such order on the exchange.',
  not_supported: 'This exchange does not support that operation.',
  readonly_blocked: 'Connection is read-only — order placement and cancellation are blocked.',
  risk_blocked: 'The order exceeds this connection’s risk limits.',
  agent_trading_disabled:
    'Agent trading is turned off for this connection — only you can place orders.',
  halted:
    'Trading is HALTED — the kill switch is engaged. Only the user can clear it, in the Trading workbench.',
  exchange_error: 'The exchange returned an error.',
}

const kit = defineTypedError<TradingErrorCode>('TradingError', FRIENDLY)

/** A typed trading error. `code` is the stable classification; `message` keeps the raw
 *  venue text so the operator sees exactly what the exchange said. */
export const TradingError = kit.DomainError
export type TradingError = TypedDomainError<TradingErrorCode>

export const toErrorInfo = kit.toErrorInfo

/**
 * ccxt names its error classes semantically (`AuthenticationError`, `InsufficientFunds`,
 * `BadSymbol`, …) and sets them as `err.constructor.name`. Matching on the NAME keeps this
 * module free of a ccxt import — it stays a pure, testable function over `unknown`, and a
 * non-ccxt driver that names its errors the same way maps for free.
 */
const BY_NAME: Record<string, TradingErrorCode> = {
  AuthenticationError: 'auth_failed',
  PermissionDenied: 'auth_failed',
  AccountSuspended: 'auth_failed',
  InvalidNonce: 'auth_failed',
  NetworkError: 'network_error',
  RequestTimeout: 'network_error',
  ExchangeNotAvailable: 'network_error',
  OnMaintenance: 'network_error',
  DDoSProtection: 'rate_limit',
  RateLimitExceeded: 'rate_limit',
  BadSymbol: 'bad_symbol',
  InsufficientFunds: 'insufficient_funds',
  InvalidOrder: 'invalid_order',
  OrderImmediatelyFillable: 'invalid_order',
  OrderNotFillable: 'invalid_order',
  OrderNotFound: 'order_not_found',
  NotSupported: 'not_supported',
  BadRequest: 'exchange_error',
  ArgumentsRequired: 'exchange_error',
  ExchangeError: 'exchange_error',
}

/** Walk the prototype chain so a venue-specific subclass still matches its ccxt base. */
function errorNames(err: unknown): string[] {
  const names: string[] = []
  let proto: object | null = err && typeof err === 'object' ? Object.getPrototypeOf(err) : null
  while (proto && proto !== Object.prototype) {
    const name = (proto as { constructor?: { name?: string } }).constructor?.name
    if (name) names.push(name)
    proto = Object.getPrototypeOf(proto)
  }
  return names
}

/**
 * Phrases that mean "the exchange would not accept who you are", whatever error CLASS the venue's
 * own classifier chose. Checked BEFORE the class, because this is the one misclassification an
 * agent cannot recover from on its own.
 *
 * Observed live: submitting with a private key whose wallet is not registered, Hyperliquid answers
 * `{"status":"err","response":"User or API Wallet 0x… does not exist."}` and ccxt raises
 * **InvalidOrder**. Told the order is invalid, an agent retries with a different size — forever —
 * when the truth is that no size would ever work until the credentials are fixed.
 *
 * `does not exist` alone is deliberately NOT enough: an order that does not exist is
 * `order_not_found`. It must be paired with a wallet/key/account subject.
 */
const AUTH_SUBJECTS = ['wallet', 'api key', 'apikey', 'account']
const AUTH_PHRASES = [
  'invalid signature',
  'signature verification',
  'unauthorized',
  'not authorized',
  'permission denied',
]

function looksLikeAuthFailure(text: string): boolean {
  if (AUTH_PHRASES.some((p) => text.includes(p))) return true
  return text.includes('does not exist') && AUTH_SUBJECTS.some((s) => text.includes(s))
}

/**
 * Classes a venue reaches for when it has no better word — the only ones an auth phrase may
 * override. A specific class (OrderNotFound, InsufficientFunds, BadSymbol, …) is the venue's own
 * typed verdict and wins over wording that merely mentions an account.
 */
const OVERRIDABLE: ReadonlySet<TradingErrorCode> = new Set(['invalid_order', 'exchange_error'])

export function mapTradingError(err: unknown): TradingError {
  if (err instanceof TradingError) return err
  const raw = err instanceof Error ? err.message : String(err)

  let typed: TradingErrorCode | undefined
  for (const name of errorNames(err)) {
    typed = BY_NAME[name]
    if (typed) break
  }
  // An auth failure dressed up as a generic order/exchange error is worse than an unclassified
  // one: it sends the caller (and the agent) to fix the order instead of the credentials.
  if ((!typed || OVERRIDABLE.has(typed)) && looksLikeAuthFailure(raw.toLowerCase()))
    return new TradingError('auth_failed', raw, { cause: err })
  if (typed) return new TradingError(typed, raw, { cause: err })

  // Fallback: a driver that throws plain Errors (or a fetch failure that never reached
  // ccxt's classifier) still lands in a sensible bucket.
  const text = raw.toLowerCase()
  const has = (...needles: string[]) => needles.some((n) => text.includes(n))
  if (has('rate limit', 'too many requests', '429'))
    return new TradingError('rate_limit', raw, { cause: err })
  if (has('econnrefused', 'enotfound', 'getaddrinfo', 'fetch failed', 'socket hang up', 'timeout'))
    return new TradingError('network_error', raw, { cause: err })
  if (has('signature', 'unauthorized', 'invalid api key', 'apikey'))
    return new TradingError('auth_failed', raw, { cause: err })
  if (has('insufficient')) return new TradingError('insufficient_funds', raw, { cause: err })
  if (has('does not have market symbol', 'unknown symbol', 'no market symbol'))
    return new TradingError('bad_symbol', raw, { cause: err })

  return new TradingError('exchange_error', raw, { cause: err })
}
