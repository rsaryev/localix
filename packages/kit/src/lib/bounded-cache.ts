/**
 * A least-recently-used cache bounded by entry count and, optionally, by total weight.
 *
 * The UI had grown one of these per feature — file snapshots in the inspector, highlighted code
 * blocks, drawn diagrams — each a hand-written `Map` with its own eviction loop, and each one a
 * place for the same rules to drift: whether a hit refreshes recency, whether a replaced value's
 * weight is released, whether one oversized value may flush every useful small one. They are
 * answered once here, and a new renderer cache (typeset math) is a call, not a fourth copy.
 *
 * `Map` insertion order is the recency queue: a hit is re-inserted at the tail, and eviction
 * takes from the head.
 *
 * The server tier has a sibling with the same surface, `apps/api/src/lib/bounded-cache.ts`: the kit
 * is browser presentation the API may not import, so the two stay in lockstep by their tests until
 * the rule moves into a leaf both tiers already share.
 */
export interface BoundedCache<K, V> {
  /** The value, refreshed to most-recently-used; undefined on a miss. */
  get(key: K): V | undefined
  /**
   * The value WITHOUT counting as a use. A read that only inspects (a dedup check, a debug view)
   * must not keep an entry alive that nothing actually uses.
   */
  peek(key: K): V | undefined
  /** Whether the key is cached, without refreshing its recency. */
  has(key: K): boolean
  /**
   * Store a value, replacing any under the same key. A value heavier than the whole budget is
   * not stored (and the old one is still dropped), so it cannot evict everything else on its
   * way in. Returns whether the value is now cached.
   */
  set(key: K, value: V): boolean
  delete(key: K): boolean
  /** Drop every entry the predicate matches — invalidation by what the value describes. */
  deleteWhere(predicate: (value: V, key: K) => boolean): void
  clear(): void
  readonly size: number
  readonly weight: number
}

export interface BoundedCacheOptions<K, V> {
  maxEntries: number
  /** Total weight budget, in whatever unit `weigh` returns. Unbounded when omitted. */
  maxWeight?: number
  /** Weight of one entry (bytes, characters…). Every entry weighs 0 when omitted. */
  weigh?: (value: V, key: K) => number
  /**
   * Called for an entry the BOUND pushed out — not for `delete`, a replacement or `clear`, which
   * the caller already sees. A value that owns a resource (a server, a pending flow) is released
   * here; otherwise a capacity eviction would leak it silently.
   */
  onEvict?: (key: K, value: V) => void
}

export function createBoundedCache<K, V>({
  maxEntries,
  maxWeight = Number.POSITIVE_INFINITY,
  weigh = () => 0,
  onEvict,
}: BoundedCacheOptions<K, V>): BoundedCache<K, V> {
  const entries = new Map<K, { value: V; weight: number }>()
  let total = 0

  const remove = (key: K): boolean => {
    const entry = entries.get(key)
    if (!entry) return false
    total -= entry.weight
    entries.delete(key)
    return true
  }

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    peek: (key) => entries.get(key)?.value,
    has: (key) => entries.has(key),
    set(key, value) {
      remove(key)
      const weight = weigh(value, key)
      if (weight > maxWeight) return false
      entries.set(key, { value, weight })
      total += weight
      while (entries.size > maxEntries || total > maxWeight) {
        const oldest = entries.entries().next()
        if (oldest.done) break
        const [oldestKey, evicted] = oldest.value
        remove(oldestKey)
        onEvict?.(oldestKey, evicted.value)
      }
      return entries.has(key)
    },
    delete: remove,
    deleteWhere(predicate) {
      for (const [key, entry] of entries) {
        if (predicate(entry.value, key)) remove(key)
      }
    },
    clear() {
      entries.clear()
      total = 0
    },
    get size() {
      return entries.size
    },
    get weight() {
      return total
    },
  }
}
