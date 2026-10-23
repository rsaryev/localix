import type { LogFollowFrame } from './log-follow-contract'

/**
 * One followed log, from whichever runtime: every output stream it writes to, and how to stop it.
 * The source has ended when any of its streams ends (the container stopped, the request closed).
 */
export interface LogSource {
  readonly output: readonly ReadableStream<Uint8Array>[]
  close(): void
}

export interface LogFollowHub<Target> {
  /** Follow `target`'s log; the listener hears the current status at once. Returns the unfollow. */
  subscribe(target: Target, listener: (frame: LogFollowFrame) => void): () => void
  /** Mini app shutdown: drop every listener and stop every source. */
  stopAll(): void
}

export interface LogFollowOptions<Target> {
  keyOf: (target: Target) => string
  /** Start following; a throw or rejection is a source that could not start. */
  open: (target: Target) => LogSource | Promise<LogSource>
  /** A source is called live once it has stayed up this long (a stopped container ends at once). */
  liveAfterMs?: number
  /**
   * Output folds into one `grew` per window: a chatty container is not a read per line. The first
   * output of a quiet spell is announced at once; a steady stream costs at most one read a window.
   */
  throttleMs?: number
  restartDelay?: (attempt: number) => number
}

interface Entry<Target> {
  key: string
  target: Target
  listeners: Set<(frame: LogFollowFrame) => void>
  source: LogSource | null
  status: 'live' | 'down'
  generation: number
  attempt: number
  dirty: boolean
  liveTimer: ReturnType<typeof setTimeout> | null
  restartTimer: ReturnType<typeof setTimeout> | null
  throttleTimer: ReturnType<typeof setTimeout> | null
}

export function followRestartDelay(attempt: number): number {
  return Math.min(1_500 * 2 ** Math.max(0, attempt), 30_000)
}

/**
 * Ref-counted log followers, one source per target however many sockets watch it. The last
 * unfollow stops the source; a source that ends while followed is restarted with a capped backoff,
 * and the reader polls meanwhile.
 */
export function createLogFollowHub<Target>(
  options: LogFollowOptions<Target>,
): LogFollowHub<Target> {
  const liveAfterMs = options.liveAfterMs ?? 1_000
  const throttleMs = options.throttleMs ?? 1_000
  const restartDelay = options.restartDelay ?? followRestartDelay
  const entries = new Map<string, Entry<Target>>()

  const broadcast = (entry: Entry<Target>, frame: LogFollowFrame) => {
    for (const listener of Array.from(entry.listeners)) {
      try {
        listener(frame)
      } catch {
        /* one socket's failure must not stop the others' frames */
      }
    }
  }
  const setStatus = (entry: Entry<Target>, status: 'live' | 'down') => {
    if (entry.status === status) return
    entry.status = status
    broadcast(entry, { kind: 'status', key: entry.key, status })
  }

  const grew = (entry: Entry<Target>) => {
    if (entry.throttleTimer) {
      entry.dirty = true
      return
    }
    broadcast(entry, { kind: 'grew', key: entry.key })
    const window = () => {
      entry.throttleTimer = null
      if (!entry.dirty) return
      entry.dirty = false
      broadcast(entry, { kind: 'grew', key: entry.key })
      entry.throttleTimer = setTimeout(window, throttleMs)
    }
    entry.throttleTimer = setTimeout(window, throttleMs)
  }

  const clearTimers = (entry: Entry<Target>) => {
    for (const timer of [entry.liveTimer, entry.restartTimer, entry.throttleTimer]) {
      if (timer) clearTimeout(timer)
    }
    entry.liveTimer = entry.restartTimer = entry.throttleTimer = null
    entry.dirty = false
  }

  const close = (entry: Entry<Target>) => {
    const source = entry.source
    entry.source = null
    try {
      source?.close()
    } catch {
      /* already gone */
    }
  }

  const ended = (entry: Entry<Target>, generation: number) => {
    if (entry.generation !== generation) return
    entry.generation++
    close(entry)
    if (entry.liveTimer) clearTimeout(entry.liveTimer)
    entry.liveTimer = null
    setStatus(entry, 'down')
    if (entry.listeners.size === 0 || entry.restartTimer) return
    entry.restartTimer = setTimeout(
      () => {
        entry.restartTimer = null
        if (entry.listeners.size > 0) void start(entry)
      },
      restartDelay(entry.attempt++),
    )
  }

  const pump = async (entry: Entry<Target>, stream: ReadableStream<Uint8Array>, gen: number) => {
    try {
      for await (const chunk of stream) {
        if (entry.generation !== gen) return
        if (chunk.byteLength > 0) grew(entry)
      }
    } catch {
      /* the source was closed mid-read */
    }
    ended(entry, gen)
  }

  const start = async (entry: Entry<Target>) => {
    const gen = ++entry.generation
    let source: LogSource
    try {
      source = await options.open(entry.target)
    } catch {
      return ended(entry, gen)
    }
    if (entry.generation !== gen) {
      try {
        source.close()
      } catch {
        /* already gone */
      }
      return
    }
    entry.source = source
    entry.liveTimer = setTimeout(() => {
      entry.liveTimer = null
      if (entry.generation !== gen) return
      entry.attempt = 0
      setStatus(entry, 'live')
    }, liveAfterMs)
    if (source.output.length === 0) return ended(entry, gen)
    for (const stream of source.output) void pump(entry, stream, gen)
  }

  const stop = (entry: Entry<Target>) => {
    entries.delete(entry.key)
    entry.generation++
    clearTimers(entry)
    close(entry)
  }

  return {
    subscribe(target, listener) {
      const key = options.keyOf(target)
      let entry = entries.get(key)
      if (!entry) {
        entry = {
          key,
          target,
          listeners: new Set(),
          source: null,
          status: 'down',
          generation: 0,
          attempt: 0,
          dirty: false,
          liveTimer: null,
          restartTimer: null,
          throttleTimer: null,
        }
        entries.set(key, entry)
      }
      const own = entry
      own.listeners.add(listener)
      listener({ kind: 'status', key, status: own.status })
      if (own.listeners.size === 1) void start(own)
      return () => {
        if (!own.listeners.delete(listener) || own.listeners.size > 0) return
        if (entries.get(key) === own) stop(own)
      }
    },
    stopAll() {
      for (const entry of Array.from(entries.values())) {
        entry.listeners.clear()
        stop(entry)
      }
    },
  }
}
