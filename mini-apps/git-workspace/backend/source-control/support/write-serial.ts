/**
 * One write at a time per repository.
 *
 * git guards its index with `index.lock` and simply FAILS the loser, so two overlapping writes in
 * the same tree — a click while another click is still running, staging a file while a commit is
 * mid-flight — surfaced to the user as a spurious "Could not stage" rather than as the queueing
 * they expected. Serializing per cwd makes concurrent UI actions queue instead of collide. Keyed
 * by cwd, so different repos of a multi-root project stay parallel.
 */
export function createWriteSerializer() {
  const writeQueue = new Map<string, Promise<unknown>>()
  return function serialize<T>(cwd: string, run: () => Promise<T>): Promise<T> {
    const prior = writeQueue.get(cwd) ?? Promise.resolve()
    // `.then(run, run)` — a failed predecessor must still release the queue.
    const next = prior.then(run, run)
    // The copy parked in the map only ORDERS the next write, so it must never reject (an
    // unobserved rejection would surface as an unhandled one) and must never carry the result
    // (which would pin it in memory until the next write).
    const parked = next.then(
      () => undefined,
      () => undefined,
    )
    writeQueue.set(cwd, parked)
    // Only the current tail clears the entry: a writer that queued behind this one has already
    // replaced it, and dropping that would unserialize them.
    void parked.then(() => {
      if (writeQueue.get(cwd) === parked) writeQueue.delete(cwd)
    })
    return next
  }
}

/**
 * Lock contention from a git we do NOT control (an agent, a terminal, a hook). git reports it
 * only as text on stderr — there is no exit code for it — so this pattern is the one place that
 * reads it.
 */
const LOCK_CONTENTION = /index\.lock|Another git process|unable to create.*\.lock/i
const LOCK_RETRIES = 2
const LOCK_BACKOFF_MS = 120

/**
 * Run `op`, retrying a couple of times when it lost a race for `index.lock`: the other process
 * usually holds the lock for milliseconds. Nothing else is retried — a rejected push or a
 * conflicted merge is an answer, not a hiccup.
 */
export async function retryOnLockContention<T>(
  op: () => Promise<T>,
  backoffMs = LOCK_BACKOFF_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (attempt >= LOCK_RETRIES || !LOCK_CONTENTION.test(message)) throw err
      await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)))
    }
  }
}
