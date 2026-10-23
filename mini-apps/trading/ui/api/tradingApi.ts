// REST client for the trading workbench backend (`/rpc/trading`). A typed error carries
// the backend `code` (mirrors `DockerApiError`/`KubeApiError`) so the UI can branch on
// `network_error` / `not_connected` quietly instead of toasting.
//
// PUBLIC MARKET DATA ONLY — the `:id` is an ephemeral `public:<exchange>` source profile and
// every route is a read. This workbench holds no credentials and has no account or order
// surface to call.
import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui/transport'
import type {
  Candle,
  ExchangeCatalogEntry,
  ExchangeInfo,
  FundingRate,
  Market,
  MarketType,
  OpenInterest,
  OrderBook,
  PublicTrade,
  Ticker,
  TradingResponses,
} from '../../backend/contracts'
import type { TradingErrorCode } from '../../backend/errors'
import { createReadCoordinator } from './readCoordinator'

export class TradingApiError extends Error {
  readonly code?: TradingErrorCode
  readonly detail?: string
  /** HTTP status of the failed response — how `isRouteMissing` tells an unmounted route
   *  (bare 404, no trading-error body) from a served refusal (which always carries `code`). */
  readonly status?: number
  constructor(message: string, code?: TradingErrorCode, detail?: string, status?: number) {
    super(message)
    this.name = 'TradingApiError'
    this.code = code
    this.detail = detail
    this.status = status
  }
}

async function readOr<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: TradingErrorCode; detail?: string })
    | null
  if (!res.ok || (json && typeof json.error === 'string')) {
    throw new TradingApiError(
      json?.error ?? `Request failed (${res.status})`,
      json?.code,
      json?.detail,
      res.status,
    )
  }
  return json as T
}

const base = '/rpc/trading'
const enc = encodeURIComponent
const sharedReads = createReadCoordinator()
const EXCHANGE_CATALOG_FRESH_MS = 5 * 60_000
const EXCHANGE_DESCRIPTION_FRESH_MS = 60_000
const MARKET_PAGE_FRESH_MS = 2_000

const get = async <T>(path: string): Promise<T> =>
  readOr<T>(await miniAppApiFetch(`${base}${path}`))
const jsonPost = async <T>(path: string, body?: unknown): Promise<T> =>
  readOr<T>(
    await miniAppApiFetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

export interface MarketsQuery {
  query?: string
  type?: MarketType
  limit?: number
  /** Force a fresh venue read of the market table (bypasses the server-side disk cache). */
  reload?: boolean
}

export interface OhlcvQuery {
  timeframe: string
  limit?: number
  /** Unix ms lower bound. */
  since?: number
  /** Unix ms upper bound — bounds what the VENUE sends, not merely the page kept. */
  until?: number
}

/** Build a `?a=1&b=2` string, dropping blank / undefined values. */
function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  return entries.length
    ? `?${entries.map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&')}`
    : ''
}

export const tradingApi = {
  /** The venue catalog: `{id, name, requiredCredentials}` per venue. NOT `ExchangeInfo`,
   *  which describes a LIVE source and needs one to exist. */
  async exchanges(): Promise<ExchangeCatalogEntry[]> {
    return sharedReads.read('exchanges', { freshForMs: EXCHANGE_CATALOG_FRESH_MS }, async () => {
      return (await get<TradingResponses['exchanges']>('/exchanges')).exchanges
    })
  },

  // ── Market data (public) ─────────────────────────────────────────────────
  async describe(id: string): Promise<ExchangeInfo> {
    const path = `/connections/${enc(id)}/describe`
    return sharedReads.read(
      `describe:${path}`,
      { freshForMs: EXCHANGE_DESCRIPTION_FRESH_MS },
      async () => (await get<TradingResponses['describe']>(path)).exchange,
    )
  },
  async markets(id: string, q: MarketsQuery = {}): Promise<Market[]> {
    const query = { query: q.query?.trim(), type: q.type, limit: q.limit }
    const path = `/connections/${enc(id)}/markets${qs(query)}`
    return sharedReads.read(
      `markets:${path}`,
      { freshForMs: MARKET_PAGE_FRESH_MS, force: q.reload === true },
      async () => {
        const requestPath = q.reload ? `${path}${path.includes('?') ? '&' : '?'}reload=1` : path
        return (await get<TradingResponses['markets']>(requestPath)).markets
      },
    )
  },
  async ticker(id: string, symbol: string): Promise<Ticker> {
    return (
      await get<TradingResponses['ticker']>(`/connections/${enc(id)}/ticker${qs({ symbol })}`)
    ).ticker
  },
  /**
   * Last prices for many symbols in one cheap read (one scoped venue request per market type).
   * The result is a SUBSET of `symbols`: an unpriceable symbol (unknown, or a builder/HIP-3 market)
   * is simply absent — the caller shows it no price, never a `0`. POST because a picker page can
   * carry hundreds of encodable symbols.
   */
  async marketTickers(id: string, symbols: string[]): Promise<Ticker[]> {
    if (symbols.length === 0) return []
    return (
      await jsonPost<TradingResponses['tickers']>(`/connections/${enc(id)}/tickers`, { symbols })
    ).tickers
  },
  async ohlcv(id: string, symbol: string, q: OhlcvQuery): Promise<Candle[]> {
    const path = `/connections/${enc(id)}/ohlcv${qs({ symbol, ...q })}`
    // Exact candle-window reads may be requested by React's mount probe and a warm chart at once.
    // Coalesce only while pending: a settled live-data read is never reused.
    return sharedReads.read(`ohlcv:${path}`, {}, async () => {
      return (await get<TradingResponses['ohlcv']>(path)).candles
    })
  },
  async orderBook(id: string, symbol: string, limit?: number): Promise<OrderBook> {
    return (
      await get<TradingResponses['orderBook']>(
        `/connections/${enc(id)}/orderbook${qs({ symbol, limit })}`,
      )
    ).orderBook
  },
  async trades(id: string, symbol: string, limit?: number): Promise<PublicTrade[]> {
    return (
      await get<TradingResponses['trades']>(
        `/connections/${enc(id)}/trades${qs({ symbol, limit })}`,
      )
    ).trades
  },
  async funding(id: string, symbol: string): Promise<FundingRate | null> {
    return (
      await get<TradingResponses['funding']>(`/connections/${enc(id)}/funding${qs({ symbol })}`)
    ).funding
  },
  async openInterest(id: string, symbol: string): Promise<OpenInterest | null> {
    return (
      await get<TradingResponses['openInterest']>(
        `/connections/${enc(id)}/open-interest${qs({ symbol })}`,
      )
    ).openInterest
  },
}
