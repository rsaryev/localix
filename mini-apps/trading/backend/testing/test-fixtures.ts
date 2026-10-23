/**
 * TEST-ONLY fixtures for the trading backend. Nothing in the mini app imports this module —
 * it is not part of `backend/index.ts`'s reachable graph, so it is never bundled.
 *
 * It exists because the two contracts the tests impersonate — `ExchangeInfo['capabilities']`
 * (23 members) and `ExchangeBackend` (24 required methods) — GROW, and a fixture hand-rolled
 * per test file quietly stops being a valid instance of the thing it stands for. A fake that
 * is missing a member the code under test reads does not fail; it reports `undefined`, and the
 * test then certifies a branch that cannot occur in production.
 *
 * So the exhaustive member lists live HERE, once. When a port gains a member, exactly this file
 * goes red, and every fixture built on it is repaired in one place. Each factory takes the
 * caller's overrides, so a test still states — and only states — what it actually exercises.
 *
 * The defaults are deliberately the INERT ones:
 *   - capabilities default to "the venue cannot do it" (`false` / `'none'`), never to a
 *     capability the test did not ask for;
 *   - backend methods default to THROWING, so a call the fixture never meant to serve fails
 *     loudly at the call site instead of returning `undefined` and being asserted on.
 */
import type { ExchangeBackend } from '../backend'
import type { ExchangeInfo } from '../contracts'

type Capabilities = ExchangeInfo['capabilities']

/** Every capability OFF. Tests turn on exactly what they exercise. */
export function exchangeCapabilities(over: Partial<Capabilities> = {}): Capabilities {
  return {
    ticker: 'none',
    ohlcv: false,
    orderBook: false,
    trades: false,
    fundingRate: 'none',
    openInterest: false,
    watch: false,
    ...over,
  }
}

/** A minimal but COMPLETE `ExchangeInfo`. `capabilities` is overridden member-wise: a caller
 *  states the ones it exercises and the rest stay off. */
export function exchangeInfo(
  over: Partial<Omit<ExchangeInfo, 'capabilities'>> & { capabilities?: Partial<Capabilities> } = {},
): ExchangeInfo {
  const { capabilities, ...rest } = over
  return {
    id: 'fake',
    name: 'Fake Exchange',
    precisionMode: 'tick',
    timeframes: ['1m', '1h', '1d'],
    requiredCredentials: [],
    ...rest,
    capabilities: exchangeCapabilities(capabilities),
  }
}

function unstubbed(method: string): () => never {
  return () => {
    throw new Error(`ExchangeBackend.${method} was called but this fixture does not stub it`)
  }
}

/**
 * A COMPLETE `ExchangeBackend` whose every unsupplied method throws. Replaces the
 * `{...} as unknown as ExchangeBackend` casts that used to stand in for it: a cast asserts the
 * fake is a backend without ever being checked, so the port could grow four methods and every
 * such fake would keep compiling — the exact thing this stub now makes impossible.
 */
export function stubExchangeBackend(over: Partial<ExchangeBackend> = {}): ExchangeBackend {
  return {
    describe: unstubbed('describe'),
    probe: unstubbed('probe'),
    loadMarkets: unstubbed('loadMarkets'),
    fetchTicker: unstubbed('fetchTicker'),
    fetchTickers: unstubbed('fetchTickers'),
    fetchOHLCV: unstubbed('fetchOHLCV'),
    fetchOrderBook: unstubbed('fetchOrderBook'),
    fetchTrades: unstubbed('fetchTrades'),
    fetchFundingRate: unstubbed('fetchFundingRate'),
    fetchOpenInterest: unstubbed('fetchOpenInterest'),
    marketTable: unstubbed('marketTable'),
    close: unstubbed('close'),
    ...over,
  }
}
