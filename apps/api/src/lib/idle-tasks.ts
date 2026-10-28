/**
 * ONE scheduler for post-listen work that no first request needs.
 *
 * The defect: every such job used to start on the same turn the login-shell env settled — the
 * usage reconcile scan (a single ~230–300 ms synchronous `bun:sqlite` statement on a cold page
 * cache, measured against a copy of a real database), the orphan session-data sweep, delegation
 * recovery, the bundled-staging report, the plugin channel/monitor hosts and the skills curator —
 * all in the window where the workspace's first burst of requests is being served. A request
 * that arrived during the scan waited for the whole scan, because a synchronous statement
 * cannot be interleaved with anything.
 *
 * So, in order: (1) wait `delayMs` past the burst, (2) wait until the event loop has been QUIET
 * for `quietMs` (timer drift under `quietLagMs`), capped by `maxWaitMs` so a loop that is never
 * quiet still gets its maintenance, then (3) run the tasks one at a time. A task that can be cut
 * into chunks calls `ctx.yield()` between them: it returns at once while the task is inside its
 * `sliceMs` budget and yields a macrotask (`setImmediate`, which lets I/O and timers run — a
 * microtask chain would starve both) once it is past it. An aborted `signal` (shutdown) stops
 * the scheduler before its next task, so nothing it holds starts after teardown began.
 */

export interface IdleTaskContext {
  readonly signal: AbortSignal
  /** Yield to the event loop if this task has held it for its slice budget. */
  yield(): Promise<void>
}

export interface IdleTask {
  name: string
  run(ctx: IdleTaskContext): unknown
}

export interface IdleSchedulerOptions {
  signal: AbortSignal
  /** Called once per task, when it settled: its wall time, and its error if it threw. */
  onTaskDone(task: string, ms: number, error?: unknown): void
  delayMs?: number
  quietMs?: number
  quietLagMs?: number
  maxWaitMs?: number
  sliceMs?: number
  /** Test seams: a clock, and a timer-based sleep (its drift is what quiet is measured by). */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const QUIET_TICK_MS = 50

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * Resolve once `quietMs` of consecutive ticks each ran within `quietLagMs` of when they were
 * due, or once `maxWaitMs` has passed. Timer drift is the measure because the thing idle work
 * competes with is main-thread time, which is exactly what delays a timer.
 */
async function waitForQuietLoop(options: {
  quietMs: number
  quietLagMs: number
  maxWaitMs: number
  signal: AbortSignal
  now: () => number
  sleep: (ms: number) => Promise<void>
}): Promise<void> {
  const { quietMs, quietLagMs, maxWaitMs, signal, now, sleep } = options
  const deadline = now() + maxWaitMs
  let quietFor = 0
  while (quietFor < quietMs && now() < deadline && !signal.aborted) {
    const due = now() + QUIET_TICK_MS
    await sleep(QUIET_TICK_MS)
    const lag = now() - due
    quietFor = lag <= quietLagMs ? quietFor + QUIET_TICK_MS : 0
  }
}

export async function runIdleTasks(
  tasks: readonly IdleTask[],
  options: IdleSchedulerOptions,
): Promise<void> {
  const now = options.now ?? (() => performance.now())
  const sleep = options.sleep ?? realSleep
  const { signal } = options
  // Small on purpose: the yield decision is made AFTER a chunk, so the longest hold is this
  // plus the next chunk. A task sizes its chunks to the frame; this only batches tiny ones.
  const sliceMs = options.sliceMs ?? 4

  if ((options.delayMs ?? 1_500) > 0) await sleep(options.delayMs ?? 1_500)
  await waitForQuietLoop({
    quietMs: options.quietMs ?? 200,
    quietLagMs: options.quietLagMs ?? 10,
    maxWaitMs: options.maxWaitMs ?? 10_000,
    signal,
    now,
    sleep,
  })

  for (const task of tasks) {
    if (signal.aborted) return
    let sliceStart = now()
    const ctx: IdleTaskContext = {
      signal,
      yield: async () => {
        if (now() - sliceStart < sliceMs) return
        await nextMacrotask()
        sliceStart = now()
      },
    }
    const started = now()
    try {
      await task.run(ctx)
      options.onTaskDone(task.name, now() - started)
    } catch (error) {
      options.onTaskDone(task.name, now() - started, error)
    }
    // Between tasks as well: the next one starts on a fresh turn.
    await nextMacrotask()
  }
}
