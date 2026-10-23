/**
 * The parsed-book cache, bounded by what it holds rather than by how many.
 *
 * It was a Map capped at 24 ENTRIES with first-in-first-out eviction. A parsed CBZ stores every
 * page inline as a base64 data URI, so one entry can be hundreds of MB and 24 of them could hold
 * gigabytes in the API process that also runs chat; and FIFO evicted the book being read the
 * moment 24 others had been opened after it, however often it was hit. Bounded by an estimate of
 * its bytes, least-recently-used out first, and a hit refreshes an entry's place.
 */
import type { ReaderChapter } from '../shared/contracts'

export interface CachedBook<Parsed> {
  fingerprint: string
  parsed: Parsed
}

interface Sized<Parsed> extends CachedBook<Parsed> {
  bytes: number
}

/** ~256 MB of parsed text and inline images. One book larger than that is still served, uncached. */
export const BOOK_CACHE_BUDGET_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 24

/** UTF-16 code units × 2 — what a JS string of that length costs, near enough to budget with. */
export function estimateParsedBytes(parsed: {
  chapters: ReadonlyArray<Pick<ReaderChapter, 'content' | 'text'>>
  cover?: string
}): number {
  let units = parsed.cover?.length ?? 0
  for (const chapter of parsed.chapters) units += chapter.content.length + chapter.text.length
  return units * 2
}

export class BookCache<Parsed> {
  private readonly entries = new Map<string, Sized<Parsed>>()
  private total = 0

  constructor(
    private readonly measure: (parsed: Parsed) => number,
    private readonly budget = BOOK_CACHE_BUDGET_BYTES,
  ) {}

  get(key: string): CachedBook<Parsed> | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    // Re-insert: Map order IS the recency order, so a hit moves the book to the back.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, value: CachedBook<Parsed>): void {
    this.delete(key)
    const bytes = this.measure(value.parsed)
    if (bytes > this.budget) return
    this.entries.set(key, { ...value, bytes })
    this.total += bytes
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.budget && this.entries.size <= MAX_ENTRIES) break
      this.entries.delete(oldest)
      this.total -= entry.bytes
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.total -= entry.bytes
  }

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.total
  }
}
