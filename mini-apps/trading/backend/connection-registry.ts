/**
 * The LIVE DRIVER REGISTRY — who holds an open exchange client for whom, and the one path
 * by which one is opened and the one by which it is closed.
 *
 * This was inline in `service.ts`, spread through a file that is otherwise a flat list of
 * venue reads — and it is the only part of that file with genuinely HIDDEN complexity, all of
 * it bug-shaped:
 *
 *   - Opening a driver is EXPENSIVE (`loadMarkets` is the heaviest venue call) and RACY.
 *     Opening a chart fires `ticker`, `positions` and `markets` near-simultaneously; without
 *     a single-flight memo all three observe an empty registry, all three build a full driver,
 *     and only the last lands in the map. The earlier ones are live exchange clients with no
 *     registry entry, so nothing can ever close them — leaked sockets and rate-limiters, on the
 *     exact surface a venue bans for. Measured: 3 concurrent first-accesses built 3 drivers and
 *     `closeAll` closed 1.
 *   - A concurrent `remove` can delete the connection WHILE we are establishing it. Registering
 *     then would resurrect a connection the user just deleted and orphan its client.
 *   - Teardown must be idempotent, must drop the read cache with the driver it came from, and
 *     must still evict a driver whose `close()` throws.
 *
 * Callers want none of that. They want: give me a live driver for this connection, drop it,
 * drop them all. That asymmetry — a small interface over real, costly, concurrent state — is
 * what makes this a module rather than a section heading.
 *
 * What stays OUT: the ORDERING policy around a store write (validate-before-mutate on an edit,
 * close-old-after-upsert, close-before-remove). That is service policy about connections, not
 * knowledge about drivers, so the service still composes `establish` / `adopt` / `close` itself.
 */
import type { ExchangeBackend, ProbeResult } from './backend'
import type { ExchangeInfo, Market, TradingConnectionConfig } from './contracts'
import { TradingError } from './errors'
import { publicConnectionConfig, publicExchangeId } from './public-connection'
import { createReadCache, type ReadCache } from './read-cache'
import { resolveConfigSecrets, type ResolveSecret } from './secret-tokens'
import type { SavedTradingConnection, TradingConnectionStore } from './store'

/** An open driver plus everything cached alongside it, for as long as it lives. */
export interface LiveEntry {
  backend: ExchangeBackend
  info: ExchangeInfo
  /** What the connect-time probe could establish — notably whether credentials were exercised. */
  probe: ProbeResult
  /** Cached market list — `loadMarkets` is the single heaviest venue call. */
  markets?: Market[]
  /** Per-connection single-flight + short-TTL cache for READ calls (see `read-cache.ts`). */
  reads: ReadCache
}

export interface ConnectionRegistryOptions {
  store: TradingConnectionStore
  /** Build a driver for a config whose `${secret:}` tokens are already resolved. */
  createBackend: (config: TradingConnectionConfig) => Promise<ExchangeBackend> | ExchangeBackend
  /** Host-provided `${secret:KEY}` resolver. Absent ⇒ tokens fail to resolve. */
  resolveSecret?: ResolveSecret
}

export interface ConnectionRegistry {
  /**
   * The saved connection behind an id — or the EPHEMERAL public profile a `public:<exchange>`
   * id names, which is credential-less and never persisted.
   */
  requireSaved: (userId: string, id: string) => Promise<SavedTradingConnection>
  /**
   * Open and probe a driver for a config. NOT registered — the caller decides whether this
   * driver becomes the live one (`adopt`) or is thrown away (a `test`, a rejected edit).
   * A driver whose probe rejects is closed here; a half-open client never escapes.
   */
  establish: (userId: string, config: TradingConnectionConfig) => Promise<LiveEntry>
  /** Register an established entry as the live driver for `id`. */
  adopt: (userId: string, id: string, entry: LiveEntry) => void
  /** Is a driver currently open for this connection? */
  isLive: (userId: string, id: string) => boolean
  /** The live driver, opening it on demand (a restart leaves saved-but-not-live connections). */
  require: (userId: string, id: string) => Promise<LiveEntry>
  /** The ONE teardown path. Idempotent; a driver that throws on close is still evicted. */
  close: (userId: string, id: string) => Promise<void>
  /** Close every open driver, for every user. Never rejects. */
  closeAll: () => Promise<void>
}

export function createConnectionRegistry(options: ConnectionRegistryOptions): ConnectionRegistry {
  const { store, createBackend } = options

  /** `userId → connectionId → live driver`. Never persisted. */
  const live = new Map<string, Map<string, LiveEntry>>()

  const liveFor = (userId: string) => {
    let m = live.get(userId)
    if (!m) live.set(userId, (m = new Map()))
    return m
  }

  /**
   * In-flight `require` calls, keyed by connection. NOT an optimisation — see the module
   * comment: without it, concurrent first-accesses each build a driver nothing can close.
   */
  const establishing = new Map<string, Promise<LiveEntry>>()

  async function requireSaved(userId: string, id: string): Promise<SavedTradingConnection> {
    const publicExchange = publicExchangeId(id)
    if (publicExchange) {
      return {
        id,
        name: `${publicExchange} public market data`,
        createdAt: 0,
        config: publicConnectionConfig(publicExchange),
      }
    }
    const conn = await store.get(userId, id)
    if (!conn) throw new TradingError('connection_not_found', `No trading connection "${id}".`)
    return conn
  }

  async function establish(userId: string, config: TradingConnectionConfig): Promise<LiveEntry> {
    const resolved = await resolveConfigSecrets(userId, config, options.resolveSecret)
    const backend = await createBackend(resolved)
    let probe: ProbeResult
    try {
      probe = await backend.probe()
    } catch (err) {
      // Never leak a half-open driver's sockets when the probe rejects.
      await backend.close()
      throw err
    }
    return { backend, info: backend.describe(), probe, reads: createReadCache() }
  }

  async function close(userId: string, id: string): Promise<void> {
    const entry = liveFor(userId).get(id)
    if (!entry) return
    liveFor(userId).delete(id)
    entry.reads.clear() // drop any cached snapshot with the driver it came from
    await entry.backend.close()
  }

  function require(userId: string, id: string): Promise<LiveEntry> {
    const existing = liveFor(userId).get(id)
    if (existing) return Promise.resolve(existing)

    const key = `${userId}\n${id}`
    const inFlight = establishing.get(key)
    if (inFlight) return inFlight

    const pending = (async () => {
      const conn = await requireSaved(userId, id)
      const entry = await establish(userId, conn.config)
      // A concurrent `remove` may have deleted the connection while we were establishing.
      // Registering the driver now would resurrect a connection the user just deleted AND orphan
      // its client, so close what we just built rather than store it.
      if (publicExchangeId(id) === null && !(await store.get(userId, id))) {
        await entry.backend.close()
        throw new TradingError('connection_not_found', `No trading connection "${id}".`)
      }
      liveFor(userId).set(id, entry)
      return entry
    })()

    establishing.set(key, pending)
    // Drop the memo once settled — but only ours, never a newer attempt's. A failed establish
    // drops its memo too, so the next caller retries instead of inheriting a cached rejection.
    void pending
      .catch(() => {})
      .finally(() => {
        if (establishing.get(key) === pending) establishing.delete(key)
      })
    return pending
  }

  return {
    requireSaved,
    establish,
    adopt: (userId, id, entry) => void liveFor(userId).set(id, entry),
    isLive: (userId, id) => liveFor(userId).has(id),
    require,
    close,
    closeAll: async () => {
      const all: Promise<void>[] = []
      for (const [userId, byId] of live) for (const id of byId.keys()) all.push(close(userId, id))
      await Promise.allSettled(all)
    },
  }
}
