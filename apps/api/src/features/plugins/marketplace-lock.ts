const tails = new Map<string, Promise<void>>()

/**
 * One change to a marketplace registry at a time, per root: every read-modify-write of
 * `known.json` (add, update, remove, the auto-update switch, a settings declaration) runs inside
 * it, so two of them never read the same file and the later write never drops the earlier one.
 * Not re-entrant: an operation that holds it must not start another that takes it.
 */
export async function withMarketplaceMutationLock<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(root) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((resolve) => {
    release = resolve
  })
  tails.set(root, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (tails.get(root) === tail) tails.delete(root)
  }
}
