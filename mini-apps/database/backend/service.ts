/**
 * Database service: saved connections (persisted, survive a restart) + a per-user
 * registry of LIVE drivers. `connect` persists the config and establishes the driver;
 * `reconnect` re-establishes a saved one on demand (we never auto-connect at startup —
 * an unreachable host would hang boot). Ownership is inherent: every method is keyed
 * by `userId`. It never imports `features/chat` and holds no engine-specific logic —
 * the driver factory does.
 *
 * Layering: this file is the FACADE — it wires the store + establish + live-registry
 * and owns the method-level flows. The pieces live in `service/`:
 *  - `service/live-entry.ts`    — LiveEntry shape + pure helpers (probe/info/close-one)
 *  - `service/establish.ts`     — secrets resolution + tunnel + driver build/probe
 *  - `service/live-registry.ts` — per-user live map, single-flight swap, teardown races
 *  - `service/run-query.ts`     — query run (guards/timeout/cancel) + atomic batch
 *  - `service/run-script.ts`    — a multi-statement text, statement by statement
 *  - `service/run-validate.ts`  — engine compile-only checks, per statement
 *  - `service/tx-routing.ts`    — which session (manual tx or driver) work runs on
 *  - `service/types.ts`         — the DatabaseService contract
 */
import { randomUUID } from 'node:crypto'
import type { DbConnectionConfig, DbConnectionInfo } from './contracts'
import { createDriver as defaultCreateDriver } from './drivers'
import type { DbDriver, DbTransaction } from './drivers/port'
import { createExclusiveQueue } from './drivers/exclusive-queue'
import { DbError, mapDbError } from './errors'
import { openTunnel } from './ssh-tunnel'
import { pinObservedHostKey, reconcileHostKeyPin } from './ssh-host-key'
import type { ConnectionStore, SavedConnection } from './store'
import { createEstablish, type SecretsResolver } from './service/establish'
import { closeLive, configKey, defaultName, infoFrom, probeDriver } from './service/live-entry'
import { createLiveRegistry } from './service/live-registry'
import { runBatch, runBrowse, runMetadata, runQuery } from './service/run-query'
import { runValidate } from './service/run-validate'
import type { DatabaseService } from './service/types'

export type { DatabaseService, SecretsResolver }

export function createDatabaseService(deps: {
  store: ConnectionStore
  /** Driver factory override (tests inject a controllable fake). Defaults to the real one. */
  /** Widened to allow a promise: the real factory imports its client library on
   *  demand (see drivers/index.ts). Every existing sync fake still satisfies it. */
  createDriver?: (config: DbConnectionConfig) => DbDriver | Promise<DbDriver>
  /** SSH-tunnel opener override (tests inject a fake — the resolved ssh config + returned
   *  local port let a test assert secret resolution + the driver-input rewrite without real
   *  socket I/O). Defaults to the real `openTunnel`. */
  openTunnel?: typeof openTunnel
  /** Server-internal secrets resolver — fills `${secret:KEY}` tokens in a connection
   *  string at connect time. Optional: connections without tokens don't need it. */
  secretsResolver?: SecretsResolver
}): DatabaseService {
  const establish = createEstablish({
    createDriver: deps.createDriver ?? defaultCreateDriver,
    openTunnel: deps.openTunnel ?? openTunnel,
    secretsResolver: deps.secretsResolver,
  })
  const registry = createLiveRegistry(establish)
  const configMutationTails = new Map<string, Promise<void>>()
  const reconnectFlights = new Map<string, Promise<DbConnectionInfo | null>>()
  const connectFlights = new Map<string, Promise<DbConnectionInfo>>()
  const connectTargetTails = new Map<string, Promise<void>>()
  const liveIdKey = (userId: string, id: string) => JSON.stringify([userId, id])

  async function withConnectTarget<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = connectTargetTails.get(key)
    const work = previous ? previous.catch(() => {}).then(run) : run()
    const tail = work.then(
      () => {},
      () => {},
    )
    connectTargetTails.set(key, tail)
    try {
      return await work
    } finally {
      if (connectTargetTails.get(key) === tail) connectTargetTails.delete(key)
    }
  }

  /**
   * Reconnect and config edits both read persisted config and replace the same live slot.
   * Serialize that read→swap→persist sequence per connection so two different config
   * generations cannot leave the store describing one target while the map holds another.
   * Disconnect/remove deliberately stay outside this queue: their teardown generation
   * must be able to veto and close an establish immediately.
   */
  async function withConfigMutation<T>(
    userId: string,
    id: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = liveIdKey(userId, id)
    const previous = configMutationTails.get(key)
    // Start the first operation immediately (until its first await). Deferring it to a
    // resolved Promise microtask lets a synchronously following remove finish teardown
    // before the reconnect has even snapshotted its generation.
    const work = previous ? previous.catch(() => {}).then(run) : run()
    const tail = work.then(
      () => {},
      () => {},
    )
    configMutationTails.set(key, tail)
    try {
      return await work
    } finally {
      if (configMutationTails.get(key) === tail) configMutationTails.delete(key)
    }
  }

  /** Close the open manual transaction (COMMIT or ROLLBACK — the two differ only in which
   *  `DbTransaction` method settles it). No-op when none is open; the activeTx slot is
   *  cleared BEFORE settling so a failed commit/rollback never leaves a stale pin. */
  async function settleTx(
    userId: string,
    id: string,
    settle: (tx: DbTransaction) => Promise<void>,
  ) {
    const live = registry.liveOf(userId, id)
    if (!live) return null
    const saved = await deps.store.get(userId, id)
    if (!saved) return null
    if (live.openingTx) {
      try {
        await live.openingTx
      } catch (err) {
        throw mapDbError(err)
      }
    }
    if (live.settlingTx) {
      try {
        await live.settlingTx
      } catch (err) {
        throw mapDbError(err)
      }
      // This request observed an already-running settlement, so it belongs to that
      // transaction boundary. Do not fall through and accidentally settle a new
      // transaction that a concurrent Begin installs after the awaited one finishes.
      return infoFrom(saved, registry.liveOf(userId, id))
    }
    if (live.activeTx) {
      const tx = live.activeTx
      const queue = live.activeTxQueue
      live.activeTx = undefined
      live.activeTxQueue = undefined
      // Every query/browse/batch that captured this transaction before the boundary owns
      // an earlier FIFO slot. Settlement runs only after those slots drain; work arriving
      // after `activeTx` was cleared observes `settlingTx` and waits on the other side.
      const settlement = queue ? queue.run(() => settle(tx)) : settle(tx)
      live.settlingTx = settlement
      try {
        await settlement
      } catch (err) {
        throw mapDbError(err)
      } finally {
        if (live.settlingTx === settlement) live.settlingTx = undefined
      }
    }
    return infoFrom(saved, registry.liveOf(userId, id))
  }

  return {
    async connect(userId, req) {
      const targetKey = JSON.stringify([userId, configKey(req.config)])
      // Exact duplicate submits share one result. Different credentials for the same
      // target must not coalesce (the later credential still needs validation), but the
      // target queue below makes them observe/preserve one saved id.
      const requestKey = JSON.stringify([userId, req])
      const existingFlight = connectFlights.get(requestKey)
      if (existingFlight) return existingFlight
      const flight = withConnectTarget(targetKey, async () => {
        // Fold a re-connect to the same target onto its existing saved entry instead of
        // piling up duplicate connections.
        const key = configKey(req.config)
        const existing = (await deps.store.list(userId)).find((c) => configKey(c.config) === key)
        // Reuse the folded id (or mint one for a brand-new target) so `swapLive` can key its
        // single-flight on it and close any stale driver as it swaps in the fresh one.
        const id = existing?.id ?? randomUUID()
        return withConfigMutation(userId, id, async () => {
          // A connect folding onto a saved target keeps its SSH host-key pin (the form never saw
          // it); a first connect pins the key it met. See `ssh-host-key.ts`.
          const connectWith = reconcileHostKeyPin(existing?.config, req.config, { inherit: true })
          // Establish + swap BEFORE persisting: a failing establish (unreachable/bad creds) throws
          // here, so a brand-new target never leaves a dead saved row behind.
          const live = await registry.swapLive(userId, id, connectWith, registry.genOf(userId, id))
          const config = pinObservedHostKey(connectWith, live.tunnel?.hostKeyFingerprint)
          // Existing target → MERGE the edit into the saved row (never rebuild it). New target →
          // CREATE a minted entity. The store forbids handing a whole record to the merge path.
          let saved: SavedConnection
          if (existing) {
            saved =
              (await deps.store.updateById(userId, id, {
                ...(req.name ? { name: req.name } : {}),
                config,
              })) ?? existing
          } else {
            saved = { id, name: defaultName(req), createdAt: Date.now(), config }
            await deps.store.create(userId, saved)
          }
          return infoFrom(saved, registry.liveOf(userId, id))
        })
      })
      const guarded = flight.finally(() => {
        if (connectFlights.get(requestKey) === guarded) connectFlights.delete(requestKey)
      })
      connectFlights.set(requestKey, guarded)
      return guarded
    },

    async testConnection(userId, config) {
      // Establish validates (SELECT 1) and throws a typed error on failure; close right away
      // so a test never leaves a live driver, tunnel, or saved entry behind.
      const live = await establish(userId, config)
      await closeLive(live)
      // The key a save would pin, so the form can show it before the user trusts it.
      const fingerprint = live.tunnel?.hostKeyFingerprint
      return fingerprint ? { hostKeyFingerprint: fingerprint } : {}
    },

    async reconnect(userId, id) {
      const key = liveIdKey(userId, id)
      const existing = reconnectFlights.get(key)
      if (existing) return existing
      const flight = withConfigMutation(userId, id, async () => {
        // Snapshot the teardown generation BEFORE the store read: a `remove` that lands while we
        // await `store.get` (whose saved snapshot then predates the removal) must still veto our
        // install, or we'd resurrect a driver for a gone connection.
        const gen = registry.genOf(userId, id)
        const saved = await deps.store.get(userId, id)
        if (!saved) return null
        // Establish + swap under the per-id single-flight: two concurrent reconnects (same saved
        // config) share ONE establish, and the swap closes any stale driver (+ its tunnel; rolls
        // back an open tx) before installing the fresh one — so a health-drop race, a double-fired
        // auto-reconnect effect, or two clients can neither open a second driver nor leak the prior.
        const live = await registry.swapLive(userId, id, saved.config, gen)
        // A connection saved before host keys were pinned gets its pin on the next reconnect.
        const pinned = pinObservedHostKey(saved.config, live.tunnel?.hostKeyFingerprint)
        const current =
          pinned === saved.config
            ? saved
            : ((await deps.store.updateById(userId, id, { config: pinned })) ?? saved)
        return infoFrom(current, registry.liveOf(userId, id))
      })
      const guarded = flight.finally(() => {
        if (reconnectFlights.get(key) === guarded) reconnectFlights.delete(key)
      })
      reconnectFlights.set(key, guarded)
      return guarded
    },

    async rename(userId, id, name) {
      const updated = await deps.store.updateById(userId, id, { name })
      if (!updated) return null
      return infoFrom(updated, registry.liveOf(userId, id))
    },

    async getConfig(userId, id) {
      const saved = await deps.store.get(userId, id)
      if (!saved) return null
      return { name: saved.name, config: saved.config }
    },

    async updateConfig(userId, id, input) {
      return withConfigMutation(userId, id, async () => {
        // Snapshot the teardown generation before the store read (same reason as `reconnect`) so a
        // concurrent remove vetoes our install rather than orphaning the new driver.
        const gen = registry.genOf(userId, id)
        const saved = await deps.store.get(userId, id)
        if (!saved) return null
        // Validate + swap the new config the same way `connect` does (throws a typed DbError on
        // an unreachable host / bad credentials — the UI renders that message; nothing persists on
        // failure). Config mutations are queued per id, so persisted config and the live target
        // move together even when another edit/reconnect arrives concurrently.
        // The edit form round-trips the pin, so a missing one here is "Forget host key"; a moved
        // bastion drops it. Either way the key this connect meets is pinned below.
        const connectWith = reconcileHostKeyPin(saved.config, input.config, { inherit: false })
        const live = await registry.swapLive(userId, id, connectWith, gen)
        // MERGE the edit into the saved row — `updateById` takes a patch, so a field this method
        // never heard of (any future column on `SavedConnection`) rides along untouched.
        // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- persist only after the replacement driver has connected successfully
        const updated = await deps.store.updateById(userId, id, {
          ...(input.name ? { name: input.name } : {}),
          config: pinObservedHostKey(connectWith, live.tunnel?.hostKeyFingerprint),
        })
        if (!updated) return null
        // `swapLive` already installed this driver. Do not install it a second time here:
        // disconnect/remove or a newer config swap may have closed/replaced it while the
        // store write was pending. Re-adding the local reference would resurrect a closed
        // driver and overwrite the actual winner.
        return infoFrom(updated, registry.liveOf(userId, id))
      })
    },

    async disconnect(userId, id) {
      // Close the live driver AND drain any establish racing this disconnect (so a mid-establish
      // driver can't repopulate the map). Returns false when there was nothing live/in-flight.
      return registry.teardownLive(userId, id)
    },

    async remove(userId, id) {
      // Bump the teardown generation and detach the current driver immediately, BEFORE joining
      // the config queue. Keep the promise instead of awaiting it here: registering the queued
      // removal synchronously is the barrier that prevents a new updateConfig/reconnect from
      // starting during an awaited driver.close(), installing against the newly bumped
      // generation, and surviving after its saved row is removed.
      const teardown = registry.teardownLive(userId, id)
      return withConfigMutation(userId, id, async () => {
        // A config mutation already in progress is allowed to settle, but this queued remove
        // always runs after it and deletes its persisted result. Mutations arriving after remove
        // queue behind this deletion, observe no saved row, and cannot recreate an orphan live
        // driver.
        await teardown
        await deps.store.remove(userId, id)
        return true
      })
    },

    async list(userId) {
      // Explicit list reads are authoritative even when native watching is unavailable.
      deps.store.invalidate?.(userId)
      const saved = await deps.store.list(userId)
      return saved.map((s) => infoFrom(s, registry.liveOf(userId, s.id)))
    },

    async query(userId, id, sql, params, opts) {
      const live = registry.liveOf(userId, id)
      if (!live) return null
      return runQuery(live, sql, params, opts)
    },

    async validate(userId, id, sql, signal) {
      const live = registry.liveOf(userId, id)
      if (!live) return null
      return runValidate(live, sql, signal)
    },

    async browse(userId, id, request, opts) {
      const live = registry.liveOf(userId, id)
      if (!live) return null
      return runBrowse(live, request, opts)
    },

    async executeBatch(userId, id, statements) {
      const live = registry.liveOf(userId, id)
      if (!live) return null
      return runBatch(live, statements)
    },

    async beginTx(userId, id) {
      if (!registry.liveOf(userId, id)) return null
      const saved = await deps.store.get(userId, id)
      if (!saved) return null
      // The store read and a transaction settlement are async boundaries. A reconnect may
      // replace the live entry across either one; always begin on the entry that owns the
      // registry slot NOW, never on a detached/closed driver captured before the await.
      while (true) {
        const live = registry.liveOf(userId, id)
        if (!live) return null
        if (live.settlingTx) {
          try {
            await live.settlingTx
          } catch (err) {
            throw mapDbError(err)
          }
          if (registry.liveOf(userId, id) !== live) continue
        }
        if (!live.activeTx) {
          if (!live.driver.beginTransaction) throw new DbError('tx_unsupported')
          const opening = live.openingTx ?? live.driver.beginTransaction()
          live.openingTx = opening
          try {
            const tx = await opening
            if (live.openingTx === opening) {
              live.openingTx = undefined
              live.activeTxQueue = createExclusiveQueue()
              live.activeTx = tx
            } else if (live.activeTx !== tx) {
              // Teardown invalidated this begin while it was pending.
              await tx.rollback().catch(() => {})
            }
          } catch (err) {
            if (live.openingTx === opening) live.openingTx = undefined
            throw mapDbError(err)
          }
        }
        return infoFrom(saved, registry.liveOf(userId, id))
      }
    },

    commitTx: (userId, id) => settleTx(userId, id, (tx) => tx.commit()),

    rollbackTx: (userId, id) => settleTx(userId, id, (tx) => tx.rollback()),

    cancel(userId, id) {
      const live = registry.liveOf(userId, id)
      if (!live) return 0
      const n = live.inflight.size
      for (const controller of live.inflight.keys()) controller.abort(new DbError('cancelled'))
      return n
    },

    async ping(userId, id) {
      const live = registry.liveOf(userId, id)
      if (!live) return false
      try {
        await probeDriver(live.driver)
        return true
      } catch {
        // Drop only the SAME entry we probed. A reconnect may have replaced it while the
        // probe was pending; a stale failure must never delete that freshly validated driver.
        if (!registry.deleteLive(userId, id, live)) {
          return !!registry.liveOf(userId, id)
        }
        await closeLive(live)
        return false
      }
    },

    async schemas(userId, id) {
      const live = registry.liveOf(userId, id)
      if (!live) return null
      return { schemas: await runMetadata(live, () => live.driver.schemas()) }
    },

    async columnCatalog(userId, id) {
      const live = registry.liveOf(userId, id)
      if (!live) return null
      const read = live.driver.columnCatalog?.bind(live.driver)
      return { catalog: read ? await runMetadata(live, read) : null }
    },

    async tableSchema(userId, id, schema, table) {
      const live = registry.liveOf(userId, id)
      if (!live) return null
      return {
        table: await runMetadata(live, () => live.driver.tableSchema(schema, table)),
      }
    },

    async recentQueries(userId, id, limit = 6) {
      return registry.liveOf(userId, id)?.recentQueries.slice(0, Math.max(0, limit)) ?? []
    },

    closeAll: () => registry.closeAll(),
  }
}
