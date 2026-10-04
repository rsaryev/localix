import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { createBoundedCache } from '../../../../lib/bounded-cache'

/**
 * Per-SESSION bookkeeping for `read`'s repeat-read dedup.
 *
 * `read` serves a short "unchanged since your earlier read" stub instead of re-sending
 * a whole file, but only while the earlier read it points at is still intact on the
 * wire. That decision needs two things per path: the content it last returned (to
 * confirm the file really is unchanged) and the `toolCallId` of the read that returned
 * it (to ask the compression layer whether it survived).
 *
 * Both used to live in a closure created by `createReadTool`, i.e. per RUN — so the
 * dedup reset on every new user message even though the stub says "this session" and
 * the earlier read is still sitting in the history. Measured on the recorded corpus:
 * 362 of 1970 full reads re-delivered a file the SAME session had already read in an
 * earlier run (~553k tokens of re-sent bytes).
 *
 * Content is kept as a hash, never as bytes: the only question ever asked is "same as
 * last time?", and a session that reads forty 100KB files should not pin 4MB. No
 * external invalidation hook is needed — `read` always hashes what it just read from
 * disk, so a change made by an editor (or anything else) simply misses the hash and the
 * full content is re-delivered.
 *
 * The unit is a path AND the WINDOW that was read, not a path. A `startLine`/`offset`
 * read returns a slice, and two reads of different slices deliver different bytes — one
 * cannot stand in for the other. Keying on the path alone meant every ranged read was
 * excluded from dedup entirely, which is where the waste concentrated: on the recorded
 * corpus, 498 of the 646 no-change repeat reads were RANGED, and every one of them
 * re-delivered its slice in full. Same window + same bytes → the model already has it.
 */
/**
 * Which slice of a file a read delivered. `undefined` = the whole file. Two reads share a
 * dedup entry only when they asked for the same window.
 */
export type ReadWindow = string | undefined

export interface ReadDedupStore {
  /** True when `content` is byte-identical to what this path+window last returned. */
  isUnchanged(path: string, window: ReadWindow, content: string): boolean
  /** The `toolCallId` of the read that last delivered this path+window. */
  lastCallId(path: string, window: ReadWindow): string | undefined
  /** Remember that `toolCallId` delivered `content` for `path`+`window`. */
  record(path: string, window: ReadWindow, content: string, toolCallId: string): void
  /** Whether a stub was already served for this entry (fallback rule — see `read.ts`). */
  stubServed(path: string, window: ReadWindow): boolean
  setStubServed(path: string, window: ReadWindow, served: boolean): void
  dispose(): void
}

/** Bound the per-session map: a long session touches far more entries than it re-reads. */
const MAX_ENTRIES = 400

const hash = (content: string): string => createHash('sha1').update(content).digest('hex')

interface Entry {
  hash: string
  toolCallId: string
  stubServed: boolean
}

/** `\0` cannot occur in a path, so the two halves can never collide. */
const entryKey = (path: string, window: ReadWindow): string =>
  `${resolve(path)}\u0000${window ?? ''}`

export function createReadDedupStore(): ReadDedupStore {
  // Only `record` is a use: the inspections below `peek`, so asking about a read never keeps
  // its entry alive past a newer one.
  const entries = createBoundedCache<string, Entry>({ maxEntries: MAX_ENTRIES })

  return {
    isUnchanged(path, window, content) {
      const entry = entries.peek(entryKey(path, window))
      return entry !== undefined && entry.hash === hash(content)
    },
    lastCallId(path, window) {
      return entries.peek(entryKey(path, window))?.toolCallId
    },
    record(path, window, content, toolCallId) {
      entries.set(entryKey(path, window), { hash: hash(content), toolCallId, stubServed: false })
    },
    stubServed(path, window) {
      return entries.peek(entryKey(path, window))?.stubServed ?? false
    },
    setStubServed(path, window, served) {
      const entry = entries.peek(entryKey(path, window))
      if (entry) entry.stubServed = served
    },
    dispose() {
      entries.clear()
    },
  }
}
