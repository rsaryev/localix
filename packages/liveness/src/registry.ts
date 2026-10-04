import { probeFor } from './probe/index'
import {
  DEFAULT_LIVENESS_POLICY,
  type LivenessListener,
  type LivenessPolicy,
  type LivenessState,
  type LivenessTarget,
  type Probe,
} from './types'

/**
 * One watcher per endpoint, shared by every subscriber, running only while somebody is
 * listening.
 *
 * No operating system offers a portable "this port closed" event — not Linux, not macOS,
 * not Windows — so every serious implementation of this polls and publishes CHANGES.
 * What separates a good one from a bad one is everything around the poll, and that is what
 * this owns:
 *
 *  - **one watcher, refcounted.** Ten preview tabs on one dev server ask one question, and
 *    nothing is asked at all while nothing is watching.
 *  - **adaptive period.** The next delay is `max(average probe cost × costFactor, period)`,
 *    capped — the watcher's share of the machine stays bounded on a slow box or a slow probe.
 *  - **thresholds.** A published state changes only after N consecutive contradicting probes,
 *    so one dropped connect during a rebuild does not report a live server as dead.
 *  - **change-only events.** Subscribers get transitions, not a heartbeat.
 *  - **`report`.** An owner that KNOWS — the process it spawned just exited, the server it
 *    holds was closed — says so, and the watcher believes it instantly instead of waiting
 *    out a period. This is the one path that is a real event rather than a poll.
 *
 * Everything schedulable is injected (`now`, `setTimer`, `clearTimer`), so the whole policy
 * is testable without sockets or real time.
 */
export interface LivenessRegistry {
  /** Subscribe to an endpoint. Starts the watcher on the first subscriber; the returned
   *  function releases it, stopping the watcher when the last one leaves. */
  watch(key: string, target: LivenessTarget, listener: LivenessListener): () => void
  /** The last known state, without starting anything. */
  peek(key: string): LivenessState | undefined
  /** Probe now (bypassing thresholds for the FIRST answer) and resolve with the state. */
  refresh(key: string): Promise<LivenessState>
  /** An owner's authoritative answer — believed at once, and it resets the schedule. */
  report(key: string, alive: boolean): void
  /** Watched endpoints, for diagnostics. */
  size(): number
}

export interface LivenessRegistryOptions {
  policy?: Partial<LivenessPolicy>
  now?: () => number
  setTimer?: (run: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

interface Entry {
  target: LivenessTarget
  probe: Probe | null
  listeners: Set<LivenessListener>
  state: LivenessState
  timer: unknown
  running: boolean
  /** Moving average of probe duration, in ms — the input to the adaptive period. */
  costMs: number
  samples: number
  abort: AbortController | null
}

export function createLivenessRegistry(options: LivenessRegistryOptions = {}): LivenessRegistry {
  const policy: LivenessPolicy = { ...DEFAULT_LIVENESS_POLICY, ...options.policy }
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimer ?? ((run, delayMs) => setTimeout(run, delayMs))
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as never))
  const entries = new Map<string, Entry>()

  const emit = (entry: Entry) => {
    const snapshot = { ...entry.state }
    for (const listener of entry.listeners) listener(snapshot)
  }

  /** Publish `alive` if it survives the threshold for its direction (or a report/first answer). */
  const settle = (entry: Entry, alive: boolean, source: 'probe' | 'report') => {
    const at = now()
    entry.state.checkedAt = at
    if (entry.state.alive === alive) {
      entry.state.pending = 0
      entry.state.source = source
      return
    }
    const needed =
      source === 'report' || entry.state.alive === undefined
        ? 1
        : alive
          ? policy.successThreshold
          : policy.failureThreshold
    entry.state.pending += 1
    if (entry.state.pending < needed) return
    entry.state = { alive, source, since: at, checkedAt: at, pending: 0 }
    emit(entry)
  }

  /** Never spend more than ~1/costFactor of the time probing. */
  const nextDelay = (entry: Entry): number =>
    Math.min(Math.max(entry.costMs * policy.costFactor, policy.periodMs), policy.maxPeriodMs)

  const schedule = (entry: Entry) => {
    if (entry.listeners.size === 0 || !entry.probe) return
    if (entry.timer !== null) clearTimer(entry.timer)
    entry.timer = setTimer(() => {
      entry.timer = null
      void run(entry)
    }, nextDelay(entry))
  }

  const run = async (entry: Entry): Promise<void> => {
    if (!entry.probe || entry.running) return
    entry.running = true
    const startedAt = now()
    const abort = new AbortController()
    entry.abort = abort
    let alive = false
    try {
      alive = await entry.probe(abort.signal)
    } catch {
      // A probe that throws is a probe that could not answer, which is not "alive".
      alive = false
    }
    entry.running = false
    entry.abort = null
    if (entry.listeners.size === 0) return
    // Weighted toward the recent past without keeping a window: the cost we are guarding
    // against is a probe that got slow, and this notices within a few samples.
    const elapsed = Math.max(0, now() - startedAt)
    entry.costMs = entry.samples === 0 ? elapsed : entry.costMs * 0.7 + elapsed * 0.3
    entry.samples += 1
    settle(entry, alive, 'probe')
    schedule(entry)
  }

  /** One probe, now, whose "down" is published as the owner's report (threshold 1). */
  const verify = async (entry: Entry): Promise<void> => {
    // A probe already in flight will answer for us.
    if (!entry.probe || entry.running) return
    if (entry.timer !== null) clearTimer(entry.timer)
    entry.timer = null
    entry.running = true
    const abort = new AbortController()
    entry.abort = abort
    let alive = false
    try {
      alive = await entry.probe(abort.signal)
    } catch {
      alive = false
    }
    entry.running = false
    entry.abort = null
    if (entry.listeners.size === 0) return
    settle(entry, alive, alive ? 'probe' : 'report')
    schedule(entry)
  }

  const ensure = (key: string, target: LivenessTarget): Entry => {
    const existing = entries.get(key)
    if (existing) return existing
    const at = now()
    const entry: Entry = {
      target,
      probe: probeFor(target, policy.timeoutMs),
      listeners: new Set(),
      state: { alive: undefined, source: 'unknown', since: at, checkedAt: 0, pending: 0 },
      timer: null,
      running: false,
      costMs: 0,
      samples: 0,
      abort: null,
    }
    entries.set(key, entry)
    return entry
  }

  const stop = (key: string, entry: Entry) => {
    if (entry.timer !== null) clearTimer(entry.timer)
    entry.timer = null
    entry.abort?.abort()
    // The state is dropped with the entry: a fact nobody has watched for a while is a fact
    // nobody has checked, and a stale "alive" is worse than an honest "unknown".
    entries.delete(key)
  }

  return {
    watch(key, target, listener) {
      const entry = ensure(key, target)
      entry.listeners.add(listener)
      if (entry.state.alive !== undefined) listener({ ...entry.state })
      if (entry.listeners.size === 1) void run(entry)
      let released = false
      return () => {
        if (released) return
        released = true
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) stop(key, entry)
      }
    },

    peek(key) {
      const entry = entries.get(key)
      return entry ? { ...entry.state } : undefined
    },

    async refresh(key) {
      const entry = entries.get(key)
      if (!entry) throw new Error(`liveness: nothing is watching "${key}"`)
      await run(entry)
      return { ...entry.state }
    },

    report(key, alive) {
      const entry = entries.get(key)
      if (!entry) return
      if (alive || !entry.probe) {
        settle(entry, alive, 'report')
        schedule(entry)
        return
      }
      // A "down" report about something we CAN probe is a reason to check now, not a verdict.
      // Two owners said "down" about servers that were up — a port scan that missed the
      // listener for one pass, and a shell that exited while its daemonised server kept the
      // port — and the next probe said "up" again: a pane that flickered. So the probe
      // decides, immediately (no wait for the period) and alone (no failure threshold: the
      // owner's word plus one refused connect is enough to publish).
      void verify(entry)
    },

    size: () => entries.size,
  }
}
