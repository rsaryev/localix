/**
 * The ccxt.pro implementation of the agnostic {@link ExchangeStreamBackend} port — the
 * websocket counterpart to `ccxt-backend.ts`'s REST driver.
 *
 * ccxt is loaded through the SAME lazy dynamic `import('ccxt')` the REST driver uses
 * (never at boot); `import()` is cached by the runtime, so this is not a second eager
 * import. Everything the socket returns is funnelled through the pure `normalize.ts`
 * translators and everything it throws through `mapTradingError`, so no ccxt type or
 * error escapes this file. The venue gets ZERO special-casing: it is an `exchangeId`
 * with the same generic credential map.
 *
 * ccxt.pro's `watchX()` is a ONE-UPDATE-AT-A-TIME promise: the caller must loop
 * (`while (running) { const x = await ex.watchX(); onData(x) }`). A single naive `await`
 * yields exactly one update and then goes silent — the loop below is the whole point.
 */
import type {
  ExchangeStreamBackend,
  ExchangeStreamOptions,
  StreamChannel,
  StreamParams,
  StreamPayload,
} from './backend'
import type { CredentialField, TradingConnectionConfig } from './contracts'
import { CREDENTIAL_FIELDS } from './contracts'
import { TradingError, mapTradingError } from './errors'
import { normalizeCandles, normalizeOrderBook, normalizeTicker, normalizeTrade } from './normalize'
import { loadCcxt } from './ccxt-exchange'

/** The slice of a ccxt.pro `Exchange` this driver calls. Declared structurally so the
 *  file compiles without importing ccxt's types (the real module arrives at runtime). */
interface CcxtProExchange {
  id: string
  name: string
  has: Record<string, unknown>
  requiredCredentials: Record<string, boolean>
  setSandboxMode(enabled: boolean): void
  loadMarkets(reload?: boolean): Promise<Record<string, unknown>>
  /** Adopt an already-loaded market table (from this venue's REST client). Synchronous. */
  setMarkets(markets: Record<string, unknown>, currencies?: Record<string, unknown>): unknown
  watchTicker(symbol: string): Promise<unknown>
  watchOHLCV(symbol: string, timeframe?: string, since?: number, limit?: number): Promise<unknown>
  watchOrderBook(symbol: string, limit?: number): Promise<unknown>
  watchTrades(symbol: string, since?: number, limit?: number): Promise<unknown[]>
  watchOrders(symbol?: string): Promise<unknown[]>
  watchMyTrades(symbol?: string): Promise<unknown[]>
  watchPositions(symbols?: string[]): Promise<unknown[]>
  watchBalance(): Promise<unknown>
  close(): Promise<unknown>
}

/** ccxt method name backing each PUBLIC channel. */
const PUBLIC_METHOD: Record<'ticker' | 'ohlcv' | 'orderbook' | 'trades', string> = {
  ticker: 'watchTicker',
  ohlcv: 'watchOHLCV',
  orderbook: 'watchOrderBook',
  trades: 'watchTrades',
}

/** ccxt method name backing each PRIVATE (credentialed) channel. */
const PRIVATE_METHOD: Record<PrivateChannel, string> = {
  orders: 'watchOrders',
  positions: 'watchPositions',
  balance: 'watchBalance',
  myTrades: 'watchMyTrades',
}

/** Public channels that address a single market — a symbol is mandatory. */
const REQUIRES_SYMBOL = new Set<StreamChannel>(['ticker', 'ohlcv', 'orderbook', 'trades'])

/** Channels that need credentials — they describe the ACCOUNT, not the market. */
type PrivateChannel = 'orders' | 'positions' | 'balance' | 'myTrades'

const PRIVATE_CHANNELS = new Set<StreamChannel>(['orders', 'positions', 'balance', 'myTrades'])

function isPrivate(channel: StreamChannel): channel is PrivateChannel {
  return PRIVATE_CHANNELS.has(channel)
}

/**
 * Build a ccxt.pro streaming client for a resolved config (credentials already
 * de-tokenized). Returns `null` when the venue has no `ccxt.pro` driver — the caller
 * degrades to polling rather than treating it as an error.
 */
export async function createCcxtStreamBackend(
  config: TradingConnectionConfig,
  opts?: ExchangeStreamOptions,
): Promise<ExchangeStreamBackend | null> {
  const ccxt = await loadCcxt()
  const Ctor = ccxt.pro?.[config.exchangeId] as
    | (new (opts: Record<string, unknown>) => CcxtProExchange)
    | undefined
  if (typeof Ctor !== 'function') return null // no live driver for this venue — poll instead

  const creds = config.credentials ?? {}
  const hasCredentials = (CREDENTIAL_FIELDS as readonly CredentialField[]).some((f) => creds[f])
  const ex = new Ctor({
    ...Object.fromEntries(CREDENTIAL_FIELDS.flatMap((f) => (creds[f] ? [[f, creds[f]]] : []))),
    enableRateLimit: true,
    ...(config.defaultType ? { options: { defaultType: config.defaultType } } : {}),
  })

  if (config.sandbox) {
    try {
      ex.setSandboxMode(true)
    } catch (err) {
      throw mapTradingError(err)
    }
  }

  /** ccxt's `has` map is tri-state — `true`, `false`, or the string `'emulated'` (a
   *  synthesized-but-working method). Anything not false/undefined is callable. */
  const hasMethod = (method: string): boolean => {
    const v = ex.has?.[method]
    return v === true || v === 'emulated'
  }

  const master = new AbortController()
  let closed = false

  const supports = (channel: StreamChannel): boolean => {
    if (isPrivate(channel)) return hasCredentials && hasMethod(PRIVATE_METHOD[channel])
    return hasMethod(PUBLIC_METHOD[channel])
  }

  /** Pull one update for the channel and hand it to `onData`, already normalized.
   *  Reads happen synchronously after the await and before the next loop turn, so an
   *  order book copied by `normalizeOrderBook` (fresh arrays) is a torn-free snapshot. */
  const pump = async (
    params: StreamParams,
    onData: (payload: StreamPayload) => void,
  ): Promise<void> => {
    const { channel, symbol, timeframe } = params
    // Public channels only — the private ones left with the account surface.
    switch (channel as 'ticker' | 'ohlcv' | 'orderbook' | 'trades') {
      case 'ticker': {
        const t = normalizeTicker(await ex.watchTicker(symbol as string), symbol)
        if (t) onData({ channel: 'ticker', symbol: t.symbol, ticker: t })
        return
      }
      case 'ohlcv': {
        const candles = normalizeCandles(await ex.watchOHLCV(symbol as string, timeframe))
        onData({ channel: 'ohlcv', symbol: symbol as string, timeframe: timeframe ?? '', candles })
        return
      }
      case 'orderbook': {
        const orderBook = normalizeOrderBook(
          await ex.watchOrderBook(symbol as string),
          symbol as string,
        )
        onData({ channel: 'orderbook', symbol: symbol as string, orderBook })
        return
      }
      case 'trades': {
        const raw = await ex.watchTrades(symbol as string)
        const trades = raw.map(normalizeTrade).filter((t): t is NonNullable<typeof t> => t !== null)
        onData({ channel: 'trades', symbol: symbol as string, trades })
      }
    }
  }

  /**
   * A venue's websocket subscribe message is keyed by its OWN market id, which the client can
   * only derive once the market table is loaded. Without this, some venues' `watchX` NEVER
   * RESOLVES — it hangs silently instead of throwing, so the stream looks alive and simply
   * never ticks, which is the worst possible failure mode for a price feed.
   *
   * Verified live: Hyperliquid's `watchTrades` blocks indefinitely before `loadMarkets()`, and
   * answers in ~1s after it. The load itself costs ~14s on that venue — almost all of it ccxt's
   * own rate limiter serialising the metadata calls (~3s with the limiter off). We keep the
   * limiter: a few seconds on first subscribe is a fair price for not risking a ban. The cost is
   * paid ONCE per client, on first subscribe (never at connect), and until it resolves the
   * registry reports `down`, so the UI polls rather than showing a frozen chart.
   */
  /**
   * Adopt the REST client's table when the caller offers one — measured 13.9s → 6ms on
   * Hyperliquid's 755 markets, after which `watchTrades` answers in ~1s. Best-effort by
   * construction: a seed that is missing, throws, or arrives in an unexpected shape falls
   * through to loading our own. A seeded client must never be a broken client.
   */
  const seedMarkets = async (): Promise<boolean> => {
    if (!opts?.seedMarketTable) return false
    try {
      const table = (await opts.seedMarketTable()) as
        | { markets?: Record<string, unknown>; currencies?: Record<string, unknown> }
        | null
        | undefined
      if (!table?.markets || Object.keys(table.markets).length === 0) return false
      ex.setMarkets(table.markets, table.currencies)
      return true
    } catch {
      return false
    }
  }

  let marketsReady: Promise<unknown> | undefined
  const ensureMarkets = () =>
    (marketsReady ??= (async () => {
      if (await seedMarkets()) return
      await ex.loadMarkets()
    })().catch((err) => {
      // Let the next subscription retry rather than caching a transient failure forever.
      marketsReady = undefined
      throw mapTradingError(err)
    }))

  return {
    supports,

    async watch(params, onData, signal) {
      if (!supports(params.channel)) {
        throw new TradingError('not_supported', `${ex.name} cannot stream ${params.channel}.`)
      }
      if (REQUIRES_SYMBOL.has(params.channel) && !params.symbol) {
        throw new TradingError('bad_symbol', `Streaming ${params.channel} requires a symbol.`)
      }
      await ensureMarkets()
      while (!signal.aborted && !master.signal.aborted) {
        try {
          await pump(params, (payload) => {
            // A late update that lands after a stop must not leak downstream.
            if (!signal.aborted && !master.signal.aborted) onData(payload)
          })
        } catch (err) {
          // An abort mid-await surfaces as a rejected socket read — a clean stop, not a failure.
          if (signal.aborted || master.signal.aborted) return
          throw mapTradingError(err)
        }
      }
    },

    stop() {
      master.abort()
    },

    async close() {
      if (closed) return
      closed = true
      master.abort()
      try {
        await ex.close()
      } catch {
        // Best-effort cleanup; a venue that throws on close must not break teardown.
      }
    },
  }
}
