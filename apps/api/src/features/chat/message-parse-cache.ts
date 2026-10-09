import type { StoredMessagePayload } from '../../db'
import { deserializeMessagePayload } from '../../db'
import { createBoundedCache } from '../../lib/bounded-cache'

/** Cached parse of one message row: content hash + length guard the reuse. */
interface ParsedRow {
  hash: number | bigint
  len: number
  payload: StoredMessagePayload
}

/** Sessions whose parsed rows are retained across listMessages calls (LRU). */
const PARSED_ROW_CACHE_SESSIONS = 6

export function createMessageParseCache() {
  // Retain parsed payloads across run starts and branch switches. Consumers treat these
  // shared objects as immutable, which also keeps downstream identity-based memos effective.
  // A 64-bit hash and exact JSON length must both match before reusing an object; direct
  // database writers therefore invalidate reuse without needing to know about this cache.
  // Each session map accumulates visited branches. Reads never discard sibling rows;
  // deleteMessagesByIds invalidates the session explicitly when it removes messages.
  // The LRU bounds the number of retained sessions, independently for each repository.
  const parsedRowCache = createBoundedCache<string, Map<string, ParsedRow>>({
    maxEntries: PARSED_ROW_CACHE_SESSIONS,
  })

  const parseRowsCached = (
    sessionId: string,
    rows: ReadonlyArray<{ id: string; payload_json: string }>,
  ): Map<string, StoredMessagePayload> => {
    const prev = parsedRowCache.get(sessionId)
    const next = new Map(prev)
    const payloads = new Map<string, StoredMessagePayload>()
    for (const row of rows) {
      const hash = Bun.hash(row.payload_json)
      const len = row.payload_json.length
      const cached = prev?.get(row.id)
      const payload =
        cached?.hash === hash && cached.len === len
          ? cached.payload
          : deserializeMessagePayload(row.payload_json)
      next.set(row.id, { hash, len, payload })
      payloads.set(row.id, payload)
    }
    parsedRowCache.set(sessionId, next)
    return payloads
  }

  return {
    parseRowsCached,
    invalidateSession: (sessionId: string) => parsedRowCache.delete(sessionId),
  }
}

export type MessageParseCache = ReturnType<typeof createMessageParseCache>
