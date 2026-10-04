/**
 * One OS port scan shared by every caller: reused for a TTL, and SINGLE-FLIGHT while it runs.
 *
 * The TTL alone left a stampede: every caller that found the cache stale started its own scan,
 * so two tabs (or a list and a reconnect) arriving within one `lsof` run spawned two `lsof`
 * pairs that answer the same question. A scan already in flight is now awaited instead of
 * repeated. A failed scan is not cached — the next caller retries — and it rejects every
 * caller that joined it, exactly as a lone scan would have.
 */
import type { ListeningPort } from './port-scan'

export interface PortScanCache {
  /** The current listener set: cached while fresh, else the in-flight scan, else a new one. */
  get(): Promise<ListeningPort[]>
}

export function createPortScanCache(
  scan: () => Promise<ListeningPort[]>,
  ttlMs: number,
  now: () => number = Date.now,
): PortScanCache {
  let last: { at: number; ports: ListeningPort[] } | undefined
  let inflight: Promise<ListeningPort[]> | undefined
  return {
    get() {
      if (last && now() - last.at < ttlMs) return Promise.resolve(last.ports)
      if (inflight) return inflight
      const startedAt = now()
      const run = scan()
        .then((ports) => {
          last = { at: startedAt, ports }
          return ports
        })
        .finally(() => {
          if (inflight === run) inflight = undefined
        })
      inflight = run
      return run
    },
  }
}
