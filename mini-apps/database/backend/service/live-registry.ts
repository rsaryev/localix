/**
 * Per-user registry of LIVE drivers + the establish→swap→teardown critical sections:
 * the per-id single-flight coalesce, the teardown-generation veto, and the leak-safe
 * swap/teardown. Owns all the mutable maps; the service facade calls through it.
 */
import type { SavedConnection } from '../store'
import { closeLive, type LiveEntry } from './live-entry'

export interface LiveRegistry {
  liveMap(userId: string): Map<string, LiveEntry>
  liveOf(userId: string, id: string): LiveEntry | undefined
  /** Current teardown generation for `(userId, id)` — snapshot BEFORE a store read. */
  genOf(userId: string, id: string): number
  swapLive(
    userId: string,
    id: string,
    config: SavedConnection['config'],
    genAtStart: number,
  ): Promise<LiveEntry>
  teardownLive(userId: string, id: string): Promise<boolean>
  /** Drop `expected` WITHOUT closing it, but only if it still owns the live slot. */
  deleteLive(userId: string, id: string, expected: LiveEntry): boolean
  closeAll(): Promise<void>
}

export function createLiveRegistry(
  establish: (userId: string, config: SavedConnection['config']) => Promise<LiveEntry>,
): LiveRegistry {
  const liveByUser = new Map<string, Map<string, LiveEntry>>()
  let shuttingDown = false

  function liveMap(userId: string): Map<string, LiveEntry> {
    let m = liveByUser.get(userId)
    if (!m) {
      m = new Map()
      liveByUser.set(userId, m)
    }
    return m
  }

  const liveOf = (userId: string, id: string) => liveByUser.get(userId)?.get(id)

  /**
   * Per-id single-flight for {@link establish}: the promise of an establish-and-swap already
   * running for a `(userId, id, config)` triple, so a second concurrent `connect`/`reconnect`/
   * `updateConfig` for the SAME id+config awaits the first instead of opening a second driver.
   * The key includes the FULL config (a config-generation), so a concurrent `updateConfig`
   * changing the config never coalesces onto — and never silently inherits a driver built from —
   * a `reconnect`'s different config: only identical work is deduplicated.
   */
  interface Establishing {
    userId: string
    id: string
    promise: Promise<LiveEntry>
  }
  const establishing = new Map<string, Establishing>()

  const establishKey = (userId: string, id: string, config: SavedConnection['config']) =>
    JSON.stringify([userId, id, config])

  const genKey = (userId: string, id: string) => JSON.stringify([userId, id])

  /**
   * Teardown generation per `(userId, id)` — bumped by every {@link teardownLive}
   * (disconnect/remove). A caller snapshots it BEFORE its store read; `swapLive` compares at
   * install time. It changing means a teardown landed since the caller decided to install — even
   * one that finished BEFORE the establish registered (a `remove` racing a `reconnect` that had
   * already snapshotted a now-deleted saved row) — so the fresh driver is closed instead of
   * repopulating the map for a torn-down connection. A synchronous compare-at-set is the only
   * race-free veto; an async re-check of the store would reopen the same TOCTOU window. Grows one
   * small entry per distinct id ever torn down (≈ the saved-connection count) — negligible.
   */
  const teardownGen = new Map<string, number>()
  const genOf = (userId: string, id: string) => teardownGen.get(genKey(userId, id)) ?? 0

  /** In-flight establish promises for `(userId, id)` across every config-generation. */
  function inflightFor(userId: string, id: string): Promise<LiveEntry>[] {
    const out: Promise<LiveEntry>[] = []
    for (const flight of establishing.values()) {
      if (flight.userId === userId && flight.id === id) out.push(flight.promise)
    }
    return out
  }

  /**
   * Establish (or join an in-flight establish for) a driver and swap it in as the live entry for
   * `id` — the ONE owner of the `establish → close-the-displaced → set(id)` critical section, so
   * `connect`/`reconnect`/`updateConfig` never each open a driver and clobber the map.
   *
   * Two guarantees:
   *  - **Single-flight (coalesce).** Same id+config in flight ⇒ the same promise ⇒ ONE driver
   *    opened for N concurrent callers. Cleared identity-guarded (only if still ours) so cleanup
   *    cannot clobber a superseding establish.
   *  - **Leak-safe swap.** The displace is a synchronous get→set (no `await` between), THEN the
   *    displaced driver is closed. Even two DIFFERENT-config establishes racing this id cannot
   *    leak: each closes exactly the driver it replaced in the map, and the map always holds one.
   */
  function swapLive(
    userId: string,
    id: string,
    config: SavedConnection['config'],
    /** The teardown generation the caller observed BEFORE its store read — see {@link teardownGen}. */
    genAtStart: number,
  ): Promise<LiveEntry> {
    if (shuttingDown) {
      return Promise.reject(new Error('Database service is shutting down.'))
    }
    const key = establishKey(userId, id, config)
    const inflight = establishing.get(key)?.promise
    if (inflight) return inflight
    const gk = genKey(userId, id)
    const flight = (async () => {
      const live = await establish(userId, config)
      // A disconnect/remove tore this id down since the caller decided to install → DON'T
      // install; close the fresh driver so a torn-down connection keeps no orphaned driver/tunnel.
      if (shuttingDown || (teardownGen.get(gk) ?? 0) !== genAtStart) {
        await closeLive(live)
        return live
      }
      // Displace synchronously (atomic w.r.t. the event loop), then close whoever we replaced.
      const prev = liveMap(userId).get(id)
      liveMap(userId).set(id, live)
      await closeLive(prev)
      return live
    })()
    const guarded = flight.finally(() => {
      if (establishing.get(key)?.promise === guarded) establishing.delete(key)
    })
    establishing.set(key, { userId, id, promise: guarded })
    return guarded
  }

  /**
   * Close + drop the live driver for `id`, INCLUDING one a concurrent establish is about to
   * install. After closing the current entry it awaits any in-flight establish for this id and
   * closes its result, so a `disconnect`/`remove` that lands mid-establish can't leave an
   * orphaned driver/tunnel (the same leak class as the concurrent swap). Returns whether there
   * was anything to tear down. */
  async function teardownLive(userId: string, id: string): Promise<boolean> {
    // Bump FIRST (before any await) so an establish whose snapshot predates this call — even one
    // that registers after us — sees the change and vetoes its own install.
    const gk = genKey(userId, id)
    teardownGen.set(gk, (teardownGen.get(gk) ?? 0) + 1)
    const live = liveOf(userId, id)
    const racing = inflightFor(userId, id)
    if (!live && racing.length === 0) return false
    if (live) {
      liveByUser.get(userId)?.delete(id)
      // Stop new callers from acquiring this entry while rollback/driver.close is still
      // pending. The detached local reference remains owned here until close completes.
      await closeLive(live)
    }
    if (racing.length > 0) {
      await Promise.all(racing.map((p) => p.catch(() => {})))
      // The establish may have re-populated the map after we cleared it — close + drop again.
      const stray = liveOf(userId, id)
      if (stray) {
        await closeLive(stray)
        liveByUser.get(userId)?.delete(id)
      }
    }
    return true
  }

  return {
    liveMap,
    liveOf,
    genOf,
    swapLive,
    teardownLive,
    deleteLive(userId, id, expected) {
      const map = liveByUser.get(userId)
      if (map?.get(id) !== expected) return false
      return map.delete(id)
    },
    async closeAll() {
      // Terminal service shutdown: flip the veto synchronously so an establish that is
      // currently probing (or any caller arriving after this point) cannot install a driver.
      // Await the in-flight swaps as well as current entries; their post-probe shutdown check
      // closes the fresh driver/tunnel before resolving.
      shuttingDown = true
      const entries = [...liveByUser.values()].flatMap((m) => [...m.values()])
      const flights = [...establishing.values()].map((flight) => flight.promise)
      await Promise.all([
        ...entries.map((entry) => closeLive(entry)),
        ...flights.map((flight) => flight.catch(() => {})),
      ])
      liveByUser.clear()
    },
  }
}
