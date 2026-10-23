/**
 * The ccxt CLIENT surface: the slice of a ccxt `Exchange` this mini app actually calls, how the
 * heavy module is loaded, and the one non-obvious fact every caller of it must know (`has` is
 * TRI-state).
 *
 * Declared STRUCTURALLY — nothing here imports ccxt's types, so every module that reads an exchange
 * (the driver, the scoped-read policy, the capability description) compiles and unit-tests against a
 * plain object fake, with no ccxt and no network. The real module only ever arrives at runtime,
 * through {@link loadCcxt}.
 */

/** The slice of a ccxt `Exchange` this mini app actually calls. */
export interface CcxtExchange {
  id: string
  name: string
  has: Record<string, unknown>
  timeframes?: Record<string, unknown>
  requiredCredentials: Record<string, boolean>
  /** ccxt's numeric precision-mode constant (see `ccxt-capabilities.ts` `PRECISION_MODES`). */
  precisionMode: number
  /** The venue's OWN rounding of a size / price to a valid increment. */
  amountToPrecision(symbol: string, amount: number): string
  priceToPrecision(symbol: string, price: number): string
  setSandboxMode(enabled: boolean): void
  loadMarkets(reload?: boolean): Promise<Record<string, unknown>>
  /** Adopt an already-loaded table (from the disk cache) so `loadMarkets` becomes a no-op. Sync. */
  setMarkets(markets: Record<string, unknown>, currencies?: Record<string, unknown>): unknown
  /** ccxt's own loaded tables — handed verbatim to a sibling client via `setMarkets`. */
  markets?: Record<string, unknown>
  currencies?: Record<string, unknown>
  /** Cheap genuine public reads used only for a liveness probe (capability-gated by `has`). */
  fetchTime(): Promise<unknown>
  fetchStatus(): Promise<unknown>
  fetchTicker(symbol: string): Promise<unknown>
  fetchTickers(
    symbols?: string[],
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  fetchOHLCV(
    symbol: string,
    timeframe?: string,
    since?: number,
    limit?: number,
    params?: Record<string, unknown>,
  ): Promise<unknown>
  fetchOrderBook(symbol: string, limit?: number): Promise<unknown>
  fetchTrades(symbol: string, since?: number, limit?: number): Promise<unknown[]>
  fetchFundingRate(symbol: string): Promise<unknown>
  /** `params` carries a builder-dex scope (`{ dex }`) for a HIP-3 market — ccxt's Hyperliquid
   *  `fetchFundingRates` forwards it into the `metaAndAssetCtxs` request; without it the plural read
   *  hits the MAIN perps context, which does not list a builder market. */
  fetchFundingRates(
    symbols?: string[],
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  fetchOpenInterest(symbol: string): Promise<unknown>
  /** The venue's per-market-type context read, which DOES forward `params` (unlike ccxt's own
   *  `fetchOpenInterests`, which drops them) — so a `{ dex }` scope can reach a HIP-3 market. Returns
   *  ccxt `Market` objects carrying the raw context in `info` for {@link CcxtExchange.parseOpenInterests}. */
  fetchSwapMarkets(params?: Record<string, unknown>): Promise<unknown[]>
  /** ccxt's own open-interest parser over already-fetched market objects — reused verbatim so no OI
   *  shape is hand-rolled. Keys the result by resolved unified symbol, filtered to `symbols`. */
  parseOpenInterests(response: unknown[], symbols?: string[]): Record<string, unknown>
  /** ccxt's own funding parser over the RAW context dicts (`Market.info` from `fetchSwapMarkets`) —
   *  reused verbatim so no funding shape is hand-rolled. */
  parseFundingRates(response: unknown[], symbols?: string[]): Record<string, unknown>
  /** ccxt's own ticker parser over a raw context dict + the market it belongs to — the exact call
   *  ccxt's `fetchTickers` makes internally (`parseTicker(market.info, market)`), reused so no
   *  ticker shape is hand-rolled from a venue's fields. */
  parseTicker(info: unknown, market?: unknown): unknown
  close(): Promise<unknown>
  // NO ACCOUNT OR ORDER METHOD IS DECLARED HERE. `fetchBalance`, `fetchPositions`,
  // `fetchOpenOrders`, `fetchMyTrades`, `fetchOrder`, `fetchClosedOrders`, `fetchFundingHistory`,
  // `createOrder`, `createOrderWithTakeProfitAndStopLoss`, `setLeverage`, `setMarginMode`,
  // `cancelOrder`, `cancelOrders`, `cancelAllOrders` and `closePosition` outlived the paths that
  // called them (`e550f0cb1`), and this client is built WITHOUT credentials, so none of them could
  // authenticate. A structural interface is a statement about what this driver does; leaving them
  // declared invited the next reader to wire one up.
}

export type CcxtModule = {
  exchanges: string[]
  pro: Record<string, unknown>
} & Record<string, unknown>

let modulePromise: Promise<CcxtModule> | undefined

/**
 * Load (once) and cache the ccxt module.
 *
 * ccxt is HEAVY (105 venues, megabytes of generated code), so it arrives through a DYNAMIC
 * `import()` on the first connect — never at boot — mirroring how the documents subsystem's drivers
 * lazily import mammoth/SheetJS/officeparser. The module cache makes every later connect free.
 */
export async function loadCcxt(): Promise<CcxtModule> {
  modulePromise ??= import('ccxt').then((m) => (m.default ?? m) as unknown as CcxtModule)
  return modulePromise
}

/**
 * ccxt's `has` map is TRI-state: `true` (native), `false` (absent), and the STRING
 * `'emulated'` (ccxt synthesizes it from another endpoint — e.g. Hyperliquid's `fetchTicker`
 * is derived from `fetchTickers`). An emulated method is a working method, so a `=== true`
 * check silently reports a supported call as missing. Anything not `false`/undefined is
 * callable.
 */
export function supports(ex: Pick<CcxtExchange, 'has'>, method: string): boolean {
  const v = ex.has?.[method]
  return v === true || v === 'emulated'
}
