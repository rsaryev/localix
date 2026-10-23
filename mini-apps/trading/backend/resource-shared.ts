/**
 * The contract BETWEEN the two halves of the `localix://resource/trade` resource provider — the menu tree
 * (`resource-tree.ts`) and the markdown expansions (`resource-expand.ts`).
 *
 * The budgets below live here rather than in either half because the two must AGREE on them:
 * a market's `candles` row advertises "last 50 1h bars" in the `@`-menu, and the expansion is
 * what must actually deliver 50. Duplicating the number would let the promise and the delivery
 * drift silently. The reads are here for the same reason — both halves resolve a market before
 * they can name the unit its sizes are counted in.
 *
 * SECURITY: the narrow {@link ResourceTradingService} port exposes no credential accessor, so
 * nothing reachable from here can put an API key, secret, or `${secret:}` token into
 * model-facing text.
 */
import type {
  TradingConnectionInfo,
  Candle,
  ExchangeCatalogEntry,
  ExchangeInfo,
  FundingRate,
  Market,
  OpenInterest,
  OrderBook,
  PublicTrade,
  Ticker,
} from './contracts'
import type { MarketTypeToken } from './uri'
import { publicConnectionConfig, publicExchangeId } from './public-connection'
import { mapTradingError, toErrorInfo } from './errors'

/** The URI provider this mini app owns. */
export const PROVIDER = 'trade'

/**
 * Narrow structural port over `TradingService` — the READ methods this provider needs (its
 * signatures line up with the service, which therefore satisfies it directly). NO order
 * placement / cancellation surface, and no credential accessor: introspection only.
 */
export interface ResourceTradingService {
  /** The venue catalog — the roots of the public-only tree (`public:<exchange>` profiles). */
  exchanges(): Promise<ExchangeCatalogEntry[]>
  describe(userId: string, id: string): Promise<ExchangeInfo>
  markets(
    userId: string,
    id: string,
    opts?: { query?: string; type?: string; limit?: number },
  ): Promise<Market[]>
  ticker(userId: string, id: string, symbol: string): Promise<Ticker>
  ohlcv(
    userId: string,
    id: string,
    symbol: string,
    timeframe: string,
    opts?: { since?: number; limit?: number },
  ): Promise<Candle[]>
  orderBook(userId: string, id: string, symbol: string, limit?: number): Promise<OrderBook>
  trades(userId: string, id: string, symbol: string, limit?: number): Promise<PublicTrade[]>
  fundingRate(userId: string, id: string, symbol: string): Promise<FundingRate | null>
  openInterest(userId: string, id: string, symbol: string): Promise<OpenInterest | null>
}

/** Human labels for the market-type folders — spot & derivatives, in reader words. */
export const MARKET_TYPE_LABELS: Record<MarketTypeToken, string> = {
  spot: 'Spot',
  swap: 'Perpetuals',
  future: 'Futures',
  margin: 'Margin',
  option: 'Options',
}

/** How many markets a Markets folder lists before truncating (token-bounded). */
export const MAX_MARKETS = 200
/** Candle bars an OHLCV leaf expands to. */
export const CANDLE_BARS = 50
/** Order-book depth an orderbook leaf shows per side. */
export const BOOK_DEPTH = 10
/** Prints a trades leaf shows. */
export const TRADE_PRINTS = 20
/**
 * Why a read failed, for an expansion that must NOT invent an answer.
 *
 * The rule this provider keeps having to enforce: a read that THREW is not a read that returned
 * nothing. `catch(() => [])` turned an unreachable venue into "No open positions" — which an
 * agent reports to a user as "nothing is at risk". Every account read therefore catches to `null`
 * and says what went wrong, and only a genuine empty array says the account is empty.
 */
export function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The same failure said as ONE sentence, for the slot that has no detail beside it.
 *
 * An expansion answers `{ ok: false, error }` and nothing else, so whatever goes there is what the
 * model — and then the person — reads. Forwarding ccxt's own words put a venue's JSON blob
 * (`bybit {"retCode":10001,...}`) in that slot; `mapTradingError` already owns the venue→code
 * mapping, so the sentence is free. {@link reason} stays raw for the DETAIL slots that have one.
 */
export function failureSentence(err: unknown): string {
  return toErrorInfo(mapTradingError(err)).message
}

/** Resolve a connection's info by id. */
export async function connInfo(
  _service: ResourceTradingService,
  _userId: string,
  id: string,
): Promise<TradingConnectionInfo | undefined> {
  // Every source is an EPHEMERAL public profile (`public:<exchange>`) — nothing is persisted,
  // because nothing is credentialed. Synthesize its read-only info here; the service establishes
  // the driver lazily on the first read.
  const exchangeId = publicExchangeId(id)
  if (!exchangeId) return undefined
  return {
    id,
    name: `${exchangeId} public market data`,
    exchangeId,
    sandbox: false,
    readonly: true,
    credentialFields: [],
    connected: true,
    risk: publicConnectionConfig(exchangeId).risk as TradingConnectionInfo['risk'],
  }
}

/** Find one market by unified symbol (exact). */
export async function findMarket(
  service: ResourceTradingService,
  userId: string,
  id: string,
  symbol: string,
): Promise<Market | undefined> {
  const markets = await service.markets(userId, id).catch(() => [] as Market[])
  return markets.find((m) => m.symbol === symbol)
}
