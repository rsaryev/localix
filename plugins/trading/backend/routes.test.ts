/**
 * The trading routes, exercised through Hono's own `app.request()` — no server, no port.
 *
 * The claims worth testing here are the boundary ones: a validation failure answers the SAME
 * typed `TradingErrorResponse` every other failure follows (zValidator does not throw — without
 * the hook it would leak the raw safeParse result), the `reload` query flag means what its
 * string says, and the status map sends each error code where its cure lives.
 */
import { describe, expect, test } from 'bun:test'
import { createTradingRoutes } from './routes'
import { TradingError } from './errors'
import type { Market, Ticker } from './contracts'
import type { TradingService } from './service'

const ticker: Ticker = { symbol: 'BTC/USDT' } as Ticker
const scope = { userId: 'test-user', projectId: '', cwd: process.cwd() }
const call = (app: ReturnType<typeof createTradingRoutes>, path: string, init?: RequestInit) =>
  app.request(path, init, scope)

/** Only the methods a test's route actually reaches — the rest would throw on touch. */
function stubService(over: Partial<TradingService> = {}): TradingService {
  return {
    ticker: async () => ticker,
    markets: async (): Promise<Market[]> => [],
    ...over,
  } as unknown as TradingService
}

describe('validation failures', () => {
  test('a missing symbol answers the typed trading-error body, not a raw ZodError dump', async () => {
    const app = createTradingRoutes(stubService())
    const res = await call(app, '/connections/c1/ticker')
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('invalid_request')
    expect(typeof body.error).toBe('string')
    // The raw safeParse shape (`{success:false, error:ZodError}`) must never reach the wire.
    expect(body).not.toHaveProperty('success')
  })

  test('detail names the offending field', async () => {
    const app = createTradingRoutes(stubService())
    const res = await call(app, '/connections/c1/orderbook?symbol=BTC/USDT&limit=0')
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('invalid_request')
    expect(String(body.detail)).toContain('limit')
  })

  test('a bad json body on the POST route follows the same contract', async () => {
    const app = createTradingRoutes(stubService())
    const res = await call(app, '/connections/c1/tickers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbols: [] }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('invalid_request')
  })
})

describe('markets reload flag', () => {
  test("'false' and '0' decline the whole-venue reload; '1' and 'true' request it", async () => {
    const seen: (boolean | undefined)[] = []
    const app = createTradingRoutes(
      stubService({
        markets: async (_u, _id, opts) => {
          seen.push(opts?.reload)
          return []
        },
      }),
    )
    for (const q of ['?reload=false', '?reload=0', '?reload=1', '?reload=true', '']) {
      expect((await call(app, `/connections/c1/markets${q}`)).status).toBe(200)
    }
    expect(seen).toEqual([false, false, true, true, undefined])
  })
})

describe('error status map', () => {
  test('auth_failed → 401: the cure is the key, not the request', async () => {
    const app = createTradingRoutes(
      stubService({
        ticker: async () => {
          throw new TradingError('auth_failed')
        },
      }),
    )
    const res = await call(app, '/connections/c1/ticker?symbol=BTC/USDT')
    expect(res.status).toBe(401)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('auth_failed')
  })

  test('connection_not_found → 404 with the typed body', async () => {
    const app = createTradingRoutes(
      stubService({
        ticker: async () => {
          throw new TradingError('connection_not_found')
        },
      }),
    )
    const res = await call(app, '/connections/nope/ticker?symbol=BTC/USDT')
    expect(res.status).toBe(404)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('connection_not_found')
  })

  test('an unreachable venue → 503, which the UI renders as a quiet empty state', async () => {
    const app = createTradingRoutes(
      stubService({
        ticker: async () => {
          throw new TradingError('network_error')
        },
      }),
    )
    const res = await call(app, '/connections/c1/ticker?symbol=BTC/USDT')
    expect(res.status).toBe(503)
    expect(((await res.json()) as Record<string, unknown>).code).toBe('network_error')
  })
})
