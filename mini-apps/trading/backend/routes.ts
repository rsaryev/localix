/**
 * Trading workbench backend routes — `/rpc/trading`.
 *
 * PUBLIC MARKET DATA ONLY. Every route here is a read of information a venue publishes to
 * anyone: the exchange catalog, market tables, quotes, candles, the order book, the trade tape,
 * funding and open interest. The `:id` is an ephemeral `public:<exchange>` source profile.
 *
 * There are no credentials, no account reads and no order routes, by design rather than by
 * omission — this workbench charts and analyses markets, and a surface that cannot authenticate
 * cannot be made to trade by a bug, a prompt injection or a mistaken click.
 *
 * `userId` is supplied by the host through the generic mini app route context.
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { routeValidator, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import type { TradingErrorResponse } from './contracts'
import {
  depthQuerySchema,
  marketsQuerySchema,
  ohlcvQuerySchema,
  symbolQuerySchema,
  tickersRequestSchema,
  type TradingResponses,
} from './contracts'
import { TradingError, mapTradingError, toErrorInfo } from './errors'
import type { TradingService } from './service'
function errorBody(err: unknown): TradingErrorResponse {
  const info = toErrorInfo(err instanceof TradingError ? err : mapTradingError(err))
  return { error: info.message, code: info.code, detail: info.detail }
}

/** A missing connection is a 404; a refused write / unsupported call a 403 / 400; an
 *  unreachable venue a 503 the sidebar renders as a quiet empty state. */
function statusFor(err: unknown): 400 | 401 | 403 | 404 | 429 | 503 {
  const mapped = err instanceof TradingError ? err : mapTradingError(err)
  switch (mapped.code) {
    case 'connection_not_found':
    case 'order_not_found':
      return 404
    // The VENUE would not accept the credentials — a 401 sends the caller to their key,
    // not to the request.
    case 'auth_failed':
      return 401
    // A refusal by policy, not by the venue: the caller is authenticated but not permitted.
    case 'readonly_blocked':
    case 'risk_blocked':
    case 'agent_trading_disabled':
    case 'halted':
      return 403
    case 'network_error':
    case 'not_connected':
      return 503
    case 'rate_limit':
      return 429
    case 'exchange_unknown':
    case 'bad_symbol':
    case 'insufficient_funds':
    case 'invalid_order':
    case 'not_supported':
    case 'exchange_error':
      break
  }
  return 400
}

async function jsonOr<T>(c: Context, fn: () => Promise<T>): Promise<Response> {
  try {
    return c.json(await fn())
  } catch (err) {
    return c.json(errorBody(err), statusFor(err))
  }
}

/**
 * A bad query/body answers in the {@link TradingErrorResponse} body every other failure follows —
 * the SDK's validator in its `flat` envelope (a validation failure answers, it does not throw).
 */
const validated = routeValidator({
  envelope: 'flat',
  code: 'invalid_request' satisfies TradingErrorResponse['code'],
})

export function createTradingRoutes(service: TradingService) {
  const app = new Hono<MiniAppRouteContext>()
  const uid = (c: Context<MiniAppRouteContext>) => c.env.userId

  const routes = app
    // ── Public sources ───────────────────────────────────────────────────────
    .get('/exchanges', (c) =>
      jsonOr<TradingResponses['exchanges']>(c, async () => ({
        exchanges: await service.exchanges(),
      })),
    )
    // ── Market data ──────────────────────────────────────────────────────────
    .get('/connections/:id/describe', (c) =>
      jsonOr<TradingResponses['describe']>(c, async () => ({
        exchange: await service.describe(uid(c), c.req.param('id')),
      })),
    )
    .get('/connections/:id/markets', validated('query', marketsQuerySchema), (c) => {
      const q = c.req.valid('query')
      return jsonOr<TradingResponses['markets']>(c, async () => ({
        markets: await service.markets(uid(c), c.req.param('id'), q),
      }))
    })
    .get('/connections/:id/ticker', validated('query', symbolQuerySchema), (c) =>
      jsonOr<TradingResponses['ticker']>(c, async () => ({
        ticker: await service.ticker(uid(c), c.req.param('id'), c.req.valid('query').symbol),
      })),
    )
    // Prices for many symbols in one cheap read — POST (not GET) because a picker page carries up to
    // 500 encodable unified symbols, past a comfortable query-string length. Idempotent read.
    .post('/connections/:id/tickers', validated('json', tickersRequestSchema), (c) =>
      jsonOr<TradingResponses['tickers']>(c, async () => ({
        tickers: await service.tickers(uid(c), c.req.param('id'), c.req.valid('json').symbols),
      })),
    )
    .get('/connections/:id/ohlcv', validated('query', ohlcvQuerySchema), (c) => {
      const { symbol, timeframe, since, limit, until } = c.req.valid('query')
      return jsonOr<TradingResponses['ohlcv']>(c, async () => ({
        symbol,
        timeframe,
        candles: await service.ohlcv(uid(c), c.req.param('id'), symbol, timeframe, {
          since,
          limit,
          until,
        }),
      }))
    })
    .get('/connections/:id/orderbook', validated('query', depthQuerySchema), (c) => {
      const { symbol, limit } = c.req.valid('query')
      return jsonOr<TradingResponses['orderBook']>(c, async () => ({
        orderBook: await service.orderBook(uid(c), c.req.param('id'), symbol, limit),
      }))
    })
    .get('/connections/:id/trades', validated('query', depthQuerySchema), (c) => {
      const { symbol, limit } = c.req.valid('query')
      return jsonOr<TradingResponses['trades']>(c, async () => ({
        trades: await service.trades(uid(c), c.req.param('id'), symbol, limit),
      }))
    })
    // A derivative's carry cost and its outstanding size. `null` for a market with neither.
    .get('/connections/:id/funding', validated('query', symbolQuerySchema), (c) => {
      const { symbol } = c.req.valid('query')
      return jsonOr<TradingResponses['funding']>(c, async () => ({
        funding: await service.fundingRate(uid(c), c.req.param('id'), symbol),
      }))
    })
    .get('/connections/:id/open-interest', validated('query', symbolQuerySchema), (c) => {
      const { symbol } = c.req.valid('query')
      return jsonOr<TradingResponses['openInterest']>(c, async () => ({
        openInterest: await service.openInterest(uid(c), c.req.param('id'), symbol),
      }))
    })

  return routes
}
