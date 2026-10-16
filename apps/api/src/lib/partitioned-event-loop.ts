export type LoopEvent<Key> = {
  key: Key
  kind: 'ready' | 'started' | 'idle' | 'failed'
}

export interface PartitionedLoopOptions<Key> {
  /** Drain ready work for one partition. Durable tasks belong to the caller's store. */
  dispatch(key: Key): Promise<void>
  concurrency?: number
  onError(error: unknown): void
}

/**
 * One process dispatcher, serial within a key and concurrent across keys. Notifications are
 * hints to re-read a durable queue, never tasks themselves. A notification during dispatch
 * schedules another pass, including one arriving as the previous pass becomes idle.
 */
export function createPartitionedEventLoop<Key>(options: PartitionedLoopOptions<Key>) {
  const concurrency = options.concurrency ?? Number.POSITIVE_INFINITY
  if (!(concurrency > 0) || (Number.isFinite(concurrency) && !Number.isInteger(concurrency))) {
    throw new Error('Event loop concurrency must be a positive integer or Infinity')
  }
  const ready = new Set<Key>()
  const running = new Map<Key, Promise<void>>()
  const timers = new Map<Key, ReturnType<typeof setTimeout>>()
  const listeners = new Set<{ key?: Key; listener: (event: LoopEvent<Key>) => void }>()
  let scheduled: ReturnType<typeof setImmediate> | undefined
  let closed = false

  const report = (error: unknown): void => {
    try {
      options.onError(error)
    } catch {
      // Error observers cannot break scheduling or leave a partition occupied.
    }
  }
  const emit = (event: LoopEvent<Key>): void => {
    for (const subscription of listeners) {
      if (subscription.key !== undefined && subscription.key !== event.key) continue
      try {
        void Promise.resolve(subscription.listener(event)).catch(report)
      } catch (error) {
        report(error)
      }
    }
  }
  const schedule = (): void => {
    if (closed || scheduled !== undefined || running.size >= concurrency) return
    if (![...ready].some((key) => !running.has(key))) return
    // Yield to I/O/timers between batches. A microtask chain can starve both indefinitely.
    scheduled = setImmediate(pump)
  }
  const notify = (key: Key): void => {
    if (closed) return
    ready.add(key)
    emit({ key, kind: 'ready' })
    schedule()
  }
  function pump(): void {
    scheduled = undefined
    if (closed) return
    for (const key of ready) {
      if (running.size >= concurrency) break
      if (running.has(key)) continue
      ready.delete(key)
      // Register ownership before invoking any user code, including observers.
      const pending = Promise.resolve()
        .then(() => {
          emit({ key, kind: 'started' })
          return options.dispatch(key)
        })
        .catch((error: unknown) => {
          report(error)
          emit({ key, kind: 'failed' })
        })
        .finally(() => {
          running.delete(key)
          emit({ key, kind: 'idle' })
          schedule()
        })
      running.set(key, pending)
    }
  }

  return {
    notify,
    /** Replace a partition's wake timer. Persist the deadline in the host if it must survive. */
    scheduleAt(key: Key, deadline: number): void {
      if (!Number.isFinite(deadline)) throw new Error('Invalid event deadline')
      const previous = timers.get(key)
      if (previous !== undefined) clearTimeout(previous)
      timers.delete(key)
      if (closed) return
      const arm = (): void => {
        const delay = deadline - Date.now()
        if (delay <= 0) {
          timers.delete(key)
          notify(key)
          return
        }
        const timer = setTimeout(arm, Math.min(delay, 2_147_483_647))
        timer.unref?.()
        timers.set(key, timer)
      }
      arm()
    },
    cancel(key: Key): void {
      ready.delete(key)
      const timer = timers.get(key)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(key)
    },
    subscribe(listener: (event: LoopEvent<Key>) => void, key?: Key): () => void {
      if (closed) throw new Error('Event loop is closed')
      const subscription = { key, listener }
      listeners.add(subscription)
      return () => {
        listeners.delete(subscription)
      }
    },
    async close(): Promise<void> {
      closed = true
      if (scheduled !== undefined) clearImmediate(scheduled)
      scheduled = undefined
      ready.clear()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      await Promise.allSettled(running.values())
      listeners.clear()
    },
  }
}
