/**
 * Await a pooled/lazy resource without letting cancellation disappear inside the await.
 *
 * An AbortSignal event cannot interleave with synchronous code, but it can fire while
 * `acquire()` is pending. Re-check after acquisition and release an exclusively-owned
 * resource (for example a MySQL PoolConnection) before surfacing the original reason.
 */
export async function acquireUnlessAborted<T>(
  acquire: () => Promise<T>,
  signal?: AbortSignal,
  release?: (resource: T) => void | Promise<void>,
): Promise<T> {
  signal?.throwIfAborted()
  const resource = await acquire()
  if (!signal?.aborted) return resource
  try {
    await release?.(resource)
  } catch {
    // Cancellation remains authoritative; cleanup is best-effort.
  }
  // An aborted signal always carries a reason (`abort()` without one sets an AbortError).
  throw signal.reason
}
