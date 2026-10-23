/**
 * FIFO exclusive lease for adapters backed by one physical connection.
 *
 * `run()` protects a single operation. `acquire()` lets a manual transaction hold the
 * connection across many calls until commit/rollback releases it. A rejected operation never
 * poisons the tail, and the returned release function is idempotent.
 */
export function createExclusiveQueue() {
  let tail: Promise<void> = Promise.resolve()
  /** Leases granted or waiting and not yet released — zero means the connection is idle. */
  let outstanding = 0

  async function acquire(): Promise<() => void> {
    const ready = tail.catch(() => {})
    let releaseGate = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    tail = ready.then(() => gate)
    outstanding++
    await ready
    let released = false
    return () => {
      if (released) return
      released = true
      outstanding--
      releaseGate()
    }
  }

  /**
   * Run `operation` only if the connection is idle right now; `undefined` when it is not.
   * For work that must never wait behind a user's query or an open manual transaction (a
   * pre-run compile check), where waiting would be worse than having no answer.
   */
  async function tryRun<T>(operation: () => T | Promise<T>): Promise<T | undefined> {
    if (outstanding > 0) return undefined
    return run(operation)
  }

  async function acquireOrAbort(signal: AbortSignal): Promise<() => void> {
    const lease = acquire()
    if (signal.aborted) {
      void lease.then((release) => release())
      throw signal.reason ?? new Error('Operation was cancelled.')
    }
    return new Promise<() => void>((resolve, reject) => {
      let settled = false
      const onAbort = () => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        // The FIFO slot still has to drain when it reaches the head, otherwise every
        // operation behind an abandoned waiter would remain blocked forever.
        void lease.then((release) => release())
        reject(signal.reason ?? new Error('Operation was cancelled.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      // `void`, matching the abort path above: the FIFO slot must drain when it reaches
      // the head, and nothing awaits this continuation.
      void lease.then((release) => {
        if (settled) {
          release()
          return
        }
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(release)
      })
    })
  }

  async function run<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = signal ? await acquireOrAbort(signal) : await acquire()
    // Abort can land after acquireOrAbort resolves its lease and removes the listener but
    // before this await continuation dispatches the operation. Recheck at the handoff so
    // cancellation never starts work merely because it hit that one-microtask window.
    if (signal?.aborted) {
      release()
      throw signal.reason ?? new Error('Operation was cancelled.')
    }
    try {
      return await operation()
    } finally {
      release()
    }
  }

  return { acquire, run, tryRun }
}

export type ExclusiveQueue = ReturnType<typeof createExclusiveQueue>
