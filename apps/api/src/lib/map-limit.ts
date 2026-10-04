/**
 * Bounded-concurrency map — the one fan-out primitive for I/O that is independent
 * per item but unbounded in count (every untracked file, every worktree, every pid).
 * A naked `Promise.all` over such a list opens N handles / spawns N processes at
 * once; this caps the in-flight count while keeping the result order.
 */

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('mapLimit limit must be a positive safe integer')
  }
  const results = Array.from<R>({ length: items.length })
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}
