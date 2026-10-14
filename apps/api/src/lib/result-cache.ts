import { createBoundedCache } from './bounded-cache'

/**
 * A bounded result cache with SINGLE-FLIGHT, for a billable computation keyed by a fingerprint of
 * its inputs: a byte-bounded LRU with a positive and a negative TTL, and identical concurrent keys
 * sharing one compute. Pure state — no timers, no I/O — so every rule is testable on an injected
 * clock. Two assistants use it (edit prediction, inline completion); each supplies only which of
 * its results may be kept, which count as positive, and what a caller who left is told.
 *
 * Single-flight invariant: a flight registered under a key is always JOINABLE. Once its last
 * subscriber leaves, the flight is aborted and can only ever produce the cancelled value, so it is
 * unregistered at that moment rather than when the factory finally settles — the window between
 * those two events is real (a provider notices an abort a tick or more later), and a caller
 * landing in it would otherwise be handed a cancellation for a request it never cancelled. Because
 * a replacement can therefore own the key while the old flight is still settling, every removal is
 * identity-guarded.
 */

export interface ResultCachePolicy<T> {
  /** Only results that ANSWERED may be kept; a failure or an abort is never pinned. */
  isCacheable(value: T): boolean
  /** Positive results live `positiveTtlMs`; the rest (an empty answer) `negativeTtlMs`. */
  isPositive(value: T): boolean
  /** What a caller whose own signal aborted first — or whose flight failed — receives. */
  cancelled: T
}

export interface ResultCacheOptions {
  /** Hard ceiling on retained result bytes; LRU-evicts to stay under it. */
  maxBytes?: number
  positiveTtlMs?: number
  negativeTtlMs?: number
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

export interface ResultCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  run(key: string, factory: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>
  stats(): { entries: number; bytes: number; inFlight: number }
}

interface Entry<T> {
  value: T
  expiresAt: number
}

interface Flight<T> {
  controller: AbortController
  promise: Promise<T>
  refs: number
}

export function createResultCache<T>(
  policy: ResultCachePolicy<T>,
  opts: ResultCacheOptions & { positiveTtlMs: number; negativeTtlMs: number; maxBytes: number },
): ResultCache<T> {
  const { maxBytes, positiveTtlMs, negativeTtlMs } = opts
  const now = opts.now ?? Date.now
  // The byte-bounded LRU is the shared owner's; this module adds only the TTL and single-flight.
  // A value larger than the whole budget is refused there, so it cannot flush every small one.
  const map = createBoundedCache<string, Entry<T>>({
    maxEntries: Number.POSITIVE_INFINITY,
    maxWeight: maxBytes,
    weigh: (entry) => JSON.stringify(entry.value).length,
  })
  const flights = new Map<string, Flight<T>>()

  function get(key: string): T | undefined {
    const entry = map.get(key)
    if (!entry) return undefined
    if (now() > entry.expiresAt) {
      map.delete(key)
      return undefined
    }
    return entry.value
  }

  function set(key: string, value: T): void {
    if (!policy.isCacheable(value)) return
    const ttl = policy.isPositive(value) ? positiveTtlMs : negativeTtlMs
    map.set(key, { value, expiresAt: now() + ttl })
  }

  async function run(
    key: string,
    factory: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let flight = flights.get(key)
    if (!flight) {
      const controller = new AbortController()
      const shared: Flight<T> = {
        controller,
        refs: 0,
        promise: factory(controller.signal)
          .then((value) => {
            set(key, value)
            return value
          })
          .finally(() => {
            // Identity-guarded: a doomed flight is unregistered EAGERLY on the last release, so
            // by the time this runs a replacement may already own the key. An unguarded delete
            // would evict that live flight and split the next two callers into separate computes.
            if (flights.get(key) === shared) flights.delete(key)
          }),
      }
      flights.set(key, shared)
      flight = shared
    }
    const entry = flight
    entry.refs++
    let released = false
    const release = () => {
      if (released) return
      released = true
      entry.refs--
      // The shared abort only fires once the LAST subscriber has left.
      if (entry.refs <= 0) {
        // Unregister BEFORE aborting: once aborted, this flight can only produce the cancelled
        // value, and a caller arriving before the factory notices would join it and be told its
        // own request was cancelled. Removing it first makes it unjoinable.
        if (flights.get(key) === entry) flights.delete(key)
        entry.controller.abort()
      }
    }

    if (signal?.aborted) {
      release()
      return policy.cancelled
    }
    if (!signal) {
      try {
        return await entry.promise
      } catch {
        return policy.cancelled
      } finally {
        release()
      }
    }
    return await new Promise<T>((resolve) => {
      const onAbort = () => {
        cleanup()
        release()
        resolve(policy.cancelled)
      }
      const cleanup = () => signal.removeEventListener('abort', onAbort)
      signal.addEventListener('abort', onAbort, { once: true })
      entry.promise.then(
        (value) => {
          cleanup()
          release()
          resolve(value)
        },
        () => {
          cleanup()
          release()
          resolve(policy.cancelled)
        },
      )
    })
  }

  return {
    get,
    set,
    run,
    stats: () => ({ entries: map.size, bytes: map.weight, inFlight: flights.size }),
  }
}
