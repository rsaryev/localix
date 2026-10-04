/**
 * A keyed cache of lazily-started preview servers — the shared lifecycle behind the
 * static file server and the injecting proxy.
 *
 * Neither server is interesting; the BOOKKEEPING around both is, and it was written
 * out twice, carrying the same compensating comment in both copies:
 *
 *  - CACHE ONLY ONCE THE PORT IS BOUND. `Bun.serve({ port: 0 })` takes an ephemeral
 *    port and `server.port` is null until it has one. Caching before that check would
 *    hand every later caller a `port!` assertion that is a lie — so the non-null check
 *    GATES the `set`, which is what makes the assertion on a cache hit sound. The rule
 *    is an ordering, and an ordering spread across two files is one edit from breaking.
 *  - DISPOSAL IS IDEMPOTENT. Shutdown can run twice (a re-entrant stop, a test); a
 *    server that is already stopped throws, and one throw must not abandon the rest of
 *    the sweep.
 *
 * Each caller keeps its OWN `Bun.serve` handler — the part that legitimately differs
 * stays in the module that owns it. This owns only the map, the ordering, and the sweep.
 */

import { createBoundedCache } from '../../../../lib/bounded-cache'

type PreviewServer = Pick<ReturnType<typeof Bun.serve>, 'port' | 'stop'>

export const DEFAULT_MAX_PREVIEW_SERVERS = 16

export interface PreviewServerCache {
  /** The bound port for `key`, starting the server via `start` on first use. */
  ensure(key: string, start: () => PreviewServer): number
  /** Stop every cached server. Idempotent. */
  dispose(): void
  /** Process-local diagnostic count. */
  size(): number
}

/** `label` names the server in the bind-failure message ("static", "proxy"). */
export function createPreviewServerCache(
  label: string,
  maxEntries = DEFAULT_MAX_PREVIEW_SERVERS,
): PreviewServerCache {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`Invalid preview ${label} server cache size: ${String(maxEntries)}`)
  }
  const stop = (server: PreviewServer): void => {
    try {
      void Promise.resolve(server.stop(true)).catch(() => {})
    } catch {
      /* already stopped */
    }
  }
  // A server the bound pushes out still holds its port; it is stopped as it leaves.
  const servers = createBoundedCache<string, PreviewServer>({
    maxEntries,
    onEvict: (_key, server) => stop(server),
  })
  return {
    ensure(key, start) {
      const existing = servers.get(key)
      if (existing) return existing.port! // sound: nothing is cached until its port is non-null
      const server = start()
      if (server.port == null) {
        stop(server)
        throw new Error(`preview ${label} server failed to bind a port`)
      }
      servers.set(key, server)
      return server.port
    },
    dispose() {
      servers.deleteWhere((server) => {
        stop(server)
        return true
      })
    },
    size() {
      return servers.size
    },
  }
}
