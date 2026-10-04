/**
 * FIFO-serialize async operations PER KEY: concurrent calls with the same key run
 * strictly in issue order (the next starts only after the previous settles), while
 * different keys run concurrently. Mirrors the per-path mutation queue
 * (`withPathLock`) but keyed by an arbitrary string. Self-cleaning — the map entry
 * is deleted once a key's chain drains, so it stays bounded.
 *
 * Used for `persistAndPublish`: the run flow, background-job flushes and the
 * delegate live-resolver all write the same assistant message; serializing by
 * messageId makes the newest-issued snapshot land last instead of racing.
 */
export function createKeyedSerializer() {
  const chains = new Map<string, Promise<void>>()
  return function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const run = prev.then(() => fn())
    // The chain link must NEVER reject — a failed op must not poison later ops on
    // the same key. The caller still observes THIS op's outcome via `run`.
    const link = run.then(
      () => {},
      () => {},
    )
    chains.set(key, link)
    void link.finally(() => {
      if (chains.get(key) === link) chains.delete(key)
    })
    return run
  }
}
