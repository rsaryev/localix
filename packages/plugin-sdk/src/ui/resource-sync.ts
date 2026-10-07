export interface ResourceSyncReader<T> {
  read: (signal: AbortSignal) => Promise<T>
  apply: (value: T) => void
  onError?: (error: unknown) => void
}

interface Task {
  generation: number
  dirty: boolean
  running: boolean
  stopped: boolean
  failures: number
  timer: ReturnType<typeof setTimeout> | null
  controller: AbortController | null
  waiters: Set<() => void>
  run: () => Promise<void>
}

/**
 * One scheduler for low-frequency read models. Domains provide reads and commits; the engine
 * knows nothing about stores, routes or entity shapes. Invalidations are coalesced, reads are
 * serial per adapter, and an invalidation/disconnect/unmount makes an older result inapplicable.
 */
export function createResourceSync<Resource extends string = string>(
  options: { retryDelaysMs?: readonly number[] } = {},
) {
  const retryDelays = options.retryDelaysMs ?? [1000, 2000, 4000]
  const tasks = new Map<Resource, Set<Task>>()
  const listeners = new Map<Resource, Set<() => void>>()
  const pendingNotifications = new Set<Resource>()
  let notificationTimer: ReturnType<typeof setTimeout> | null = null
  let connected = false

  function notify(resource: Resource): void {
    pendingNotifications.add(resource)
    if (notificationTimer) return
    notificationTimer = setTimeout(() => {
      notificationTimer = null
      const pending = [...pendingNotifications]
      pendingNotifications.clear()
      for (const key of pending)
        for (const listener of listeners.get(key) ?? []) {
          try {
            listener()
          } catch (error) {
            console.warn('[realtime] resource observer failed', error)
          }
        }
    }, 0)
  }

  function schedule(task: Task, delay = 0): void {
    if (!connected || task.stopped || task.running || task.timer) return
    task.timer = setTimeout(() => {
      task.timer = null
      void task.run()
    }, delay)
  }

  function invalidate(resources: readonly Resource[], read = true): void {
    for (const resource of new Set(resources)) {
      for (const task of tasks.get(resource) ?? []) {
        task.generation++
        if (read) {
          task.failures = 0
          if (task.timer) clearTimeout(task.timer)
          task.timer = null
        }
        // Direct stream patches only supersede an outstanding read; settled data needs no GET.
        task.dirty = read || task.dirty || task.running
        if (task.dirty) schedule(task)
      }
      if (read) notify(resource)
    }
  }

  function register<T>(resource: Resource, reader: ResourceSyncReader<T>): () => void {
    const task: Task = {
      generation: 0,
      dirty: true,
      running: false,
      stopped: false,
      failures: 0,
      timer: null,
      controller: null,
      waiters: new Set(),
      run: async () => {
        if (!connected || task.stopped || !task.dirty) return
        task.running = true
        task.dirty = false
        const generation = task.generation
        const controller = new AbortController()
        task.controller = controller
        try {
          const value = await reader.read(controller.signal)
          if (!task.stopped && connected && generation === task.generation) {
            reader.apply(value)
            task.failures = 0
          }
        } catch (error) {
          if (!task.stopped && connected && generation === task.generation) {
            task.failures++
            task.dirty = task.failures <= retryDelays.length
            if (!task.dirty) reader.onError?.(error)
          }
        } finally {
          task.controller = null
          task.running = false
          if (task.dirty) schedule(task, task.failures ? (retryDelays[task.failures - 1] ?? 0) : 0)
          if (!task.dirty || !connected || task.stopped) {
            for (const done of task.waiters) done()
            task.waiters.clear()
          }
        }
      },
    }
    const set = tasks.get(resource) ?? new Set<Task>()
    set.add(task)
    tasks.set(resource, set)
    schedule(task)
    return () => {
      task.stopped = true
      for (const done of task.waiters) done()
      task.waiters.clear()
      task.controller?.abort()
      if (task.timer) clearTimeout(task.timer)
      set.delete(task)
      if (!set.size) tasks.delete(resource)
    }
  }

  return {
    register,
    invalidate,
    /** Explicit refresh joins the next authoritative read, including a superseding follow-up. */
    refresh(resources: readonly Resource[]): Promise<void> {
      invalidate(resources)
      if (!connected) return Promise.resolve()
      return Promise.all(
        resources.flatMap((resource) =>
          [...(tasks.get(resource) ?? [])].map(
            (task) => new Promise<void>((done) => task.waiters.add(done)),
          ),
        ),
      ).then(() => undefined)
    },
    /** For caches/editor effects with their own read and conflict policies. */
    subscribe(resource: Resource, listener: () => void): () => void {
      const set = listeners.get(resource) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(resource, set)
      return () => {
        set.delete(listener)
        if (!set.size) listeners.delete(resource)
      }
    },
    connected(): void {
      connected = true
      for (const set of tasks.values()) for (const task of set) task.failures = 0
      invalidate([...new Set([...tasks.keys(), ...listeners.keys()])])
    },
    disconnected(): void {
      connected = false
      if (notificationTimer) clearTimeout(notificationTimer)
      notificationTimer = null
      pendingNotifications.clear()
      for (const set of tasks.values())
        for (const task of set) {
          task.generation++
          for (const done of task.waiters) done()
          task.waiters.clear()
          task.dirty = true
          task.controller?.abort()
          if (task.timer) clearTimeout(task.timer)
          task.timer = null
        }
    },
  }
}
