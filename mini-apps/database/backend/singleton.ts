/**
 * Process-wide database-service singleton.
 *
 * The workbench's `register()` runs MORE THAN ONCE per process: once at boot (the
 * backend/route contribution, via `loadMiniAppBackends`) and again per agent run (the
 * `database_client` tool contribution, via the per-run mini app loader). Both paths share
 * ONE `DatabaseService` instance, because the live-driver registry (open connections,
 * manual transactions) lives in memory on the instance — a second instance would have an
 * empty registry and every tool query would return "not connected" even though the UI
 * opened a connection through the route on the first instance.
 *
 * So the service is held on `globalThis` (survives the fresh per-call module import the
 * mini app loader does) and built lazily on first `register()`. The one host capability it
 * needs — resolving `${secret:KEY}` tokens against the central vault — arrives through the
 * generic mini app `ctx.host.resolveSecret` seam; the boot-time load supplies the real
 * resolver, and the latest real host always wins (captured below), so per-run calls that
 * lack a host simply reuse the already-built service.
 */
import { join } from 'node:path'
import { observeMutations, safeFileKey } from '@localixai/mini-app-sdk/backend'
import type { ConnectionStore } from './store'
import { createDatabaseService, type DatabaseService } from './service'
import { createConnectionStore } from './store'

/** Resolve one `${secret:KEY}` value for a user (host-provided). Returns undefined when
 *  the secret is absent or the vault is unavailable. */
export type ResolveSecret = (userId: string, key: string) => Promise<string | undefined>

interface Holder {
  service?: DatabaseService
  store?: ConnectionStore
  listeners?: Set<(path: string) => void>
  resolveSecret?: ResolveSecret
}

const GLOBAL_KEY = Symbol.for('localix.mini-app.database.services')

function holder(): Holder {
  const g = globalThis as { [key: symbol]: Holder | undefined }
  return (g[GLOBAL_KEY] ??= {})
}

/**
 * Get (or lazily build) the process-wide database service. Pass the host's secret
 * resolver on the FIRST (boot) call so `${secret:KEY}` connection tokens resolve; later
 * calls with a real resolver update it (latest real host wins), calls without one reuse
 * whatever is already bound.
 */
export function getDatabaseService(options: {
  dataDir: string
  resolveSecret?: ResolveSecret
}): DatabaseService {
  const h = holder()
  if (options.resolveSecret) h.resolveSecret = options.resolveSecret
  if (!h.service) {
    h.store = createConnectionStore({ dir: options.dataDir })
    h.service = createDatabaseService({
      store: h.store,
      // Adapt the host's generic secret resolver to the service's narrow resolver
      // (undefined → null). Reads the LATEST bound host so a boot-time real resolver
      // is used even for a service first requested by a per-run tool load.
      secretsResolver: {
        resolve: async (userId, key) => (await holder().resolveSecret?.(userId, key)) ?? null,
      },
    })
    observeMutations(
      h.service,
      {
        connect: ['connections'],
        reconnect: ['connections'],
        rename: ['connections'],
        updateConfig: ['connections'],
        disconnect: ['connections'],
        remove: ['connections'],
      },
      (userId) => {
        const file = join(options.dataDir, `${safeFileKey(userId)}.json`)
        for (const listener of h.listeners ?? []) {
          try {
            listener(file)
          } catch {
            /* A committed write remains successful. */
          }
        }
      },
    )
  }
  return h.service
}

/**
 * The service a registration hands to its routes, providers and tool: never an instance, always
 * the CURRENT one, resolved on every call.
 *
 * The defect it stops: the host re-wires a mini app by loading the NEW registration first and only
 * then unwiring the old one. The new routes had already captured the live instance when the old
 * registration's `onShutdown` released it, so the routes served a closed instance — and its
 * saved-connection list, which the store caches after the first read, froze. The next agent turn
 * found no service and built a second one. A connection the agent added went into the second
 * instance's list and the file on disk, and the workbench — reading the first — never showed it,
 * reload or not. With every caller resolving through the holder there is only ever one instance,
 * and a release just means the next call builds a fresh one from disk.
 */
export function currentDatabaseService(options: {
  dataDir: string
  resolveSecret?: ResolveSecret
}): DatabaseService {
  return new Proxy({} as DatabaseService, {
    get(_target, key) {
      const service = getDatabaseService(options)
      const value: unknown = Reflect.get(service, key)
      return typeof value === 'function' ? value.bind(service) : value
    },
  })
}

/**
 * Shut the current service down AND let go of it, so the next call builds a fresh one.
 *
 * `closeAll()` is terminal on purpose (it vetoes every later establish, so a probe in flight
 * cannot install a driver into a dying process). The host calls this through `onShutdown` not
 * only at process exit but whenever it UNWIRES the backend — a hot reload, a disable followed by
 * an enable. Holding on to the closed instance refused every later connect with "Database service
 * is shutting down." until the API restarted. Saved connections live on disk, so a fresh instance
 * loses only the live drivers, which the workbench reconnects on its next request.
 */
export async function releaseDatabaseService(): Promise<void> {
  const h = holder()
  const service = h.service
  h.service = undefined
  await service?.closeAll()
}

/** Shared by route and per-run tool service instances, including hot reloads. */
export function subscribeDatabaseWrites(listener: (path: string) => void): () => void {
  const listeners = (holder().listeners ??= new Set())
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function invalidateDatabaseSnapshot(userId: string): void {
  holder().store?.invalidate?.(userId)
}
