import type { UiSession } from '@/shared/api/contracts'

export const WARM_SESSION_BODY_MAX_ENTRIES = 3
export const WARM_SESSION_BODY_MAX_BYTES = 8 * 1024 * 1024

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

interface CacheEntry {
  session: UiSession
  bytes: number
}

/** Small in-memory LRU for idle session bodies used by cache-first switching. */
export class WarmSessionBodyCache {
  readonly #entries = new Map<string, CacheEntry>()
  readonly #maxEntries: number
  readonly #maxBytes: number
  readonly #estimateBytes: (session: UiSession) => number
  #bytes = 0

  constructor(options?: {
    maxEntries?: number
    maxBytes?: number
    estimateBytes?: (session: UiSession) => number
  }) {
    this.#maxEntries = options?.maxEntries ?? WARM_SESSION_BODY_MAX_ENTRIES
    this.#maxBytes = options?.maxBytes ?? WARM_SESSION_BODY_MAX_BYTES
    this.#estimateBytes = options?.estimateBytes ?? jsonByteLength
  }

  get(id: string): UiSession | undefined {
    const entry = this.#entries.get(id)
    if (!entry) return undefined
    // Map insertion order is the LRU order; a read makes the body hottest.
    this.#entries.delete(id)
    this.#entries.set(id, entry)
    return entry.session
  }

  put(session: UiSession): void {
    // Running bodies remain live in the store and are never candidates for this
    // idle-only cache (or for the store eviction performed on a switch).
    if (session.isRunning || session.messages.length === 0) return
    const bytes = this.#estimateBytes(session)
    this.delete(session.id)
    if (bytes > this.#maxBytes || this.#maxEntries <= 0) return

    this.#entries.set(session.id, { session, bytes })
    this.#bytes += bytes
    while (this.#entries.size > this.#maxEntries || this.#bytes > this.#maxBytes) {
      const oldest = this.#entries.entries().next().value as [string, CacheEntry] | undefined
      if (!oldest) break
      this.#entries.delete(oldest[0])
      this.#bytes -= oldest[1].bytes
    }
  }

  delete(id: string): void {
    const entry = this.#entries.get(id)
    if (!entry) return
    this.#entries.delete(id)
    this.#bytes -= entry.bytes
  }

  /** Test/performance instrumentation; does not expose mutable entries. */
  stats(): { entries: number; bytes: number; ids: string[] } {
    return { entries: this.#entries.size, bytes: this.#bytes, ids: [...this.#entries.keys()] }
  }
}
