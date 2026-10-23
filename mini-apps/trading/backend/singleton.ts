/**
 * Process-wide trading-service singleton.
 *
 * `register()` runs MORE THAN ONCE per process: once at boot (route/subsystem contribution
 * via `loadMiniAppBackends`) and again per agent run (the tool contribution, via the per-run
 * mini app loader). BOTH must share ONE `TradingService`, because the live-driver registry
 * (open exchange clients, their keep-alive sockets and rate-limiters) lives in memory on the
 * instance — a second instance would re-authenticate on every agent call and leak sockets.
 *
 * So the service is held on `globalThis` (surviving the fresh per-call module import the
 * mini app loader does) and built lazily on first `register()`. The one host capability it
 * needs — resolving `${secret:KEY}` credentials — arrives through the generic mini app
 * `ctx.host.resolveSecret` seam; the boot-time load supplies the real resolver, and the
 * latest real host always wins.
 */
import path from 'node:path'
import type { ResolveSecret, StoreSecret } from './secret-tokens'
import { createTradingService, type TradingService } from './service'
import { createTradingConnectionStore } from './store'
import { createMarketTableCache } from './market-table-cache'

interface Holder {
  service?: TradingService
  resolveSecret?: ResolveSecret
  storeSecret?: StoreSecret
}

const GLOBAL_KEY = Symbol.for('localix.mini-app.trading.services')

function holder(): Holder {
  const g = globalThis as { [key: symbol]: Holder | undefined }
  return (g[GLOBAL_KEY] ??= {})
}

/** Capture the host's create-only vault writer (boot load only; a load without one never clears it). */
export function bindStoreSecret(storeSecret: StoreSecret): void {
  holder().storeSecret = storeSecret
}

export function getTradingService(options: {
  dataDir: string
  resolveSecret?: ResolveSecret
}): TradingService {
  const h = holder()
  if (options.resolveSecret) h.resolveSecret = options.resolveSecret
  h.service ??= createTradingService({
    store: createTradingConnectionStore({
      dir: path.join(options.dataDir, 'connections'),
    }),
    // Venue-keyed on-disk market-table cache — pays the ~14s `loadMarkets` once across processes.
    marketCache: createMarketTableCache({
      dir: path.join(options.dataDir, 'market-cache'),
    }),
  })
  return h.service
}
