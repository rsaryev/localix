/**
 * ONE writer for facts that producers hand over and never wait on.
 *
 * A producer enqueues and moves on: `enqueue` never awaits and never throws, so a run, a request
 * or a tool call is never slowed or failed by bookkeeping. Jobs queue in-process and one drain
 * writes them in order, a batch per transaction, so concurrent producers cannot interleave half a
 * write and SQLite sees one writer instead of many. A batch that fails is retried job by job, so
 * one poisoned job loses only itself. Each job's outcome is reported AFTER its transaction
 * committed — a subscriber is never told about a row the database does not hold.
 *
 * The window a crash can lose is the batch in flight; what must survive one is either recorded in
 * the caller's own transaction instead, or re-derived at boot by its consumer.
 */
import type { Transaction } from 'kysely'

export interface BatchWriter<Job> {
  /** Queue a job. False (and dropped) once the writer is closed. Never throws. */
  enqueue(job: Job): boolean
  /** Resolves once everything queued so far is committed. */
  flush(): Promise<void>
  /** Stop taking jobs and commit what is queued. Idempotent. */
  close(): Promise<void>
}

export function createBatchWriter<DB, Job, Result>(deps: {
  transaction: <T>(run: (trx: Transaction<DB>) => Promise<T>) => Promise<T>
  /** Write one job inside the batch's transaction. */
  apply: (trx: Transaction<DB>, job: Job, at: number) => Promise<Result>
  /** One job's outcome, after commit: its result, or the error that dropped it. */
  settled?: (job: Job, outcome: { result: Result } | { error: unknown }) => void
  /** Wraps a whole batch transaction (busy retries). */
  retry?: <T>(operation: () => Promise<T>) => Promise<T>
  log?: (event: string, detail: Record<string, unknown>) => void
  /** The event name a dropped job is logged under, and what to say about the job. */
  failureEvent: string
  describe?: (job: Job) => Record<string, unknown>
  now?: () => number
}): BatchWriter<Job> {
  const now = deps.now ?? Date.now
  const retry = deps.retry ?? (<T>(operation: () => Promise<T>) => operation())
  let queue: Job[] = []
  let draining: Promise<void> | null = null
  let closed = false

  // A failure report must never become the failure: during teardown the logger may be gone.
  const log = (event: string, detail: Record<string, unknown>) => {
    try {
      deps.log?.(event, detail)
    } catch {
      /* the log sink is closed */
    }
  }
  const settle = (job: Job, outcome: { result: Result } | { error: unknown }) => {
    try {
      deps.settled?.(job, outcome)
    } catch {
      /* one bad listener never breaks the writer */
    }
  }
  const message = (error: unknown) => String(error instanceof Error ? error.message : error)

  async function drain(): Promise<void> {
    // Yield once so every job queued in the same tick joins the first transaction.
    await Promise.resolve()
    while (queue.length > 0) {
      const batch = queue
      queue = []
      const at = now()
      try {
        const results = await retry(() =>
          deps.transaction(async (trx) => {
            const out: Result[] = []
            for (const job of batch) out.push(await deps.apply(trx, job, at))
            return out
          }),
        )
        batch.forEach((job, index) => settle(job, { result: results[index]! }))
      } catch (batchError) {
        // One poisoned job must not lose the rest of the batch: retry each on its own.
        for (const job of batch) {
          try {
            settle(job, { result: await deps.transaction((trx) => deps.apply(trx, job, at)) })
          } catch (error) {
            log(deps.failureEvent, {
              ...deps.describe?.(job),
              error: message(error),
              batchError: message(batchError),
            })
            settle(job, { error })
          }
        }
      }
    }
  }

  // One drain at a time. A job queued after the loop saw an empty queue but before `finally` ran
  // would otherwise wait for the next unrelated job, so `finally` re-schedules.
  function schedule() {
    draining ??= drain().finally(() => {
      draining = null
      if (queue.length > 0) schedule()
    })
  }

  async function flush(): Promise<void> {
    while (draining) await draining
  }

  return {
    enqueue(job) {
      if (closed) return false
      queue.push(job)
      schedule()
      return true
    },
    flush,
    async close() {
      closed = true
      await flush()
    },
  }
}
