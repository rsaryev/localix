/**
 * What a ccxt venue CAN do, translated into our vocabulary once.
 *
 * Everything above the driver — the routes, the UI, the risk gate, the agent tool — branches on
 * `ExchangeInfo.capabilities`, never on ccxt's raw `has` map. This module is where that translation
 * lives, and it exists as its own file because it is the one place that must get three subtle facts
 * right, all of them ccxt-specific and none of them the driver's business:
 *
 * - `has` is TRI-state, so an `'emulated'` method is a WORKING method (`supports`, in
 *   `ccxt-exchange.ts`) — but its PROVENANCE still matters to a caller, because an emulated read can
 *   cost a whole-venue fan-out. Hence `OperationSupport` (`native` / `emulated` / `none`) rather than
 *   a boolean, wherever the difference changes what a caller should do.
 * - A venue lacking a native call may still OFFER the operation when it has the primitives to
 *   synthesize one (a close = fetchPositions + createOrder; a bulk-cancel = fetchOpenOrders +
 *   cancelOrders). That is reported as provenance, never assumed.
 * - `precisionMode` is a numeric constant, and reading it as anything but a TICK SIZE mis-renders
 *   every size on every venue that reports one (which is all of them today).
 */
import type {
  CredentialField,
  ExchangeCatalogEntry,
  ExchangeInfo,
  OperationSupport,
  PrecisionMode,
} from './contracts'
import { CREDENTIAL_FIELDS } from './contracts'
import type { ExchangeCatalog } from './backend'
import { loadCcxt, supports, type CcxtExchange } from './ccxt-exchange'

/**
 * The connect-form catalog. Each entry needs the venue's display name and its required credential
 * fields, and ccxt exposes both only on a CONSTRUCTED exchange — the ids alone say nothing about
 * what to ask the user for. Constructing all ~105 classes costs ~90ms and no network, so it is done
 * ONCE and memoized for the process; a class that fails to construct is skipped rather than sinking
 * the whole list.
 */
let catalogCache: ExchangeCatalogEntry[] | undefined

export const ccxtExchangeCatalog: ExchangeCatalog = async () => {
  if (catalogCache) return catalogCache
  const ccxt = await loadCcxt()
  const entries: ExchangeCatalogEntry[] = []
  for (const id of [...ccxt.exchanges].sort()) {
    try {
      const ex = new (ccxt as unknown as Record<string, new () => CcxtExchange>)[id]!()
      entries.push({ id, name: ex.name || id, requiredCredentials: requiredCredentials(ex) })
    } catch {
      // A venue whose class will not even construct cannot be connected to; leaving it out of the
      // picker is honest, and one bad class must not empty the list.
    }
  }
  catalogCache = entries
  return entries
}

/** Which of OUR credential fields the venue marks required. */
export function requiredCredentials(
  ex: Pick<CcxtExchange, 'requiredCredentials'>,
): CredentialField[] {
  return CREDENTIAL_FIELDS.filter((f) => Boolean(ex.requiredCredentials?.[f]))
}

/** ccxt's precision-mode constants: DECIMAL_PLACES=2, SIGNIFICANT_DIGITS=3, TICK_SIZE=4.
 *  Every major venue reports TICK_SIZE, where `precision.price = 1` is a STEP of 1. */
const PRECISION_MODES: Record<number, PrecisionMode> = {
  2: 'decimals',
  3: 'significant',
  4: 'tick',
}

/**
 * Provenance of an operation the venue may lack natively. `native` wins; otherwise it is
 * `emulated` when the venue has the primitives to synthesize it, else `none`. Reported so a
 * caller (and the UI) knows whether the operation exists AND how it will be served.
 */
function operationSupport(native: boolean, canEmulate: boolean): OperationSupport {
  return native ? 'native' : canEmulate ? 'emulated' : 'none'
}

/**
 * `true` only when the venue's loaded market for `symbol` explicitly says it is NOT a derivative.
 * An unloaded or odd-shaped market answers `false`, so the read is attempted and the venue decides —
 * we never silently report "no funding" because we could not identify the market.
 */
export function isKnownNonContract(ex: Pick<CcxtExchange, 'markets'>, symbol: string): boolean {
  const m = ex.markets?.[symbol]
  return !!m && typeof m === 'object' && (m as { contract?: unknown }).contract === false
}

/** Translate a constructed ccxt exchange into the agnostic {@link ExchangeInfo} everything above the
 *  driver reads. `watch` says whether the venue has a ccxt.pro websocket client. */
export function describeExchange(ex: CcxtExchange, watch: boolean): ExchangeInfo {
  const has = (k: string) => supports(ex, k)
  return {
    id: ex.id,
    name: ex.name,
    // An unknown mode would make a client mis-render every size; `tick` is what every
    // venue ccxt currently ships reports, and it is the safe reading (a step, not a count).
    precisionMode: PRECISION_MODES[ex.precisionMode] ?? 'tick',
    timeframes: Object.keys(ex.timeframes ?? {}),
    requiredCredentials: requiredCredentials(ex),
    capabilities: {
      // PROVENANCE for the single-ticker read: `has()` collapses `'emulated'` to true, so read
      // the RAW tri-state. An emulated `fetchTicker` (Hyperliquid) is synthesized from a BULK
      // `fetchTickers` — ~12 throttled `/info` requests, ~12.7s of serial throttle SLEEP (measured
      // wall 12748ms / cpu 514ms), NOT CPU — so the service serves one symbol from the cached full
      // map instead. `native` reads the single symbol directly.
      ticker:
        ex.has?.['fetchTicker'] === 'emulated'
          ? 'emulated'
          : has('fetchTicker')
            ? 'native'
            : 'none',
      ohlcv: has('fetchOHLCV'),
      orderBook: has('fetchOrderBook'),
      trades: has('fetchTrades'),
      // Hyperliquid reports `fetchFundingRate: false` but `fetchFundingRates: true`, so the
      // single-symbol read is EMULATED from the plural one. Calling the singular blind would throw.
      fundingRate: operationSupport(has('fetchFundingRate'), has('fetchFundingRates')),
      openInterest: has('fetchOpenInterest'),
      watch,
      // NOTHING ACCOUNT-SHAPED IS PROBED HERE ANY MORE. `fetchBalance`/`fetchPositions`/
      // `createOrder`/`setLeverage`/… were reported per venue and printed to the model by
      // `market_data`, long after `e550f0cb1` deleted every path that could call them — and this
      // driver is now built WITHOUT credentials, so a private call cannot even authenticate. A
      // capability list is a promise; these were promises about code that does not exist. See the
      // contract in `contracts/market.ts` for the full removed set.
    },
  }
}
