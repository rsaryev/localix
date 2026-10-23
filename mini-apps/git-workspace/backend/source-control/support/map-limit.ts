/**
 * Bounded-concurrency map for repository fan-out. Kept mini-app-local so the Git
 * implementation does not reach through the host's private utility tree.
 */
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
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
