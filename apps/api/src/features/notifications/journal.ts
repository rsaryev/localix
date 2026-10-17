import type { Transaction } from 'kysely'

import type { AppDatabase } from '../../db/types'
import { retrySqliteBusy } from '../../db/seq'
import type { ClientJournalOp, InboxChange, RaiseFact, SettleFact } from './contracts'
import { isPending, isRepeatOf, raise, read, repeat, settle } from './projection'
import { createNotificationRepository } from './repository'
import type { NotificationJournal, NotificationJournalDeps } from './journal-contracts'

export type { NotificationJournal, NotificationJournalDeps } from './journal-contracts'
import { pruneJournal } from './retention'

/**
 * THE ONE WRITE PATH into the notification journal, for the server and the client alike.
 *
 * A producer records a fact at the seam where it became final and moves on: `record` and `settle`
 * never await, never throw, and never slow a run down. Facts queue in-process and ONE writer drains
 * them in order, a batch per transaction, so concurrent producers cannot interleave half a
 * transition and SQLite sees one writer instead of many. The window a crash can lose is the batch
 * in flight; facts with a durable source of their own are re-recorded at boot, and the projection's
 * idempotency (`projection.ts`) makes that safe.
 *
 * A committed change is published to the user's live subscribers (the socket) AFTER commit, so a
 * client never sees a row the database does not hold.
 */

type Source = 'server' | 'client'
type Op =
  | { kind: 'raise'; fact: RaiseFact }
  | { kind: 'settle'; fact: SettleFact }
  | { kind: 'read'; keys: string[] }
  | { kind: 'read_through'; seq: number }
  | { kind: 'remove'; key: string }
  | { kind: 'clear' }

interface Job {
  userId: string
  source: Source
  op: Op
  opId?: string
  done?: (changes: InboxChange[]) => void
  fail?: (error: unknown) => void
}

export function createNotificationJournal(deps: NotificationJournalDeps): NotificationJournal {
  const repo = createNotificationRepository(deps.db)
  const now = deps.now ?? Date.now
  const redact = deps.redact ?? ((_userId: string, text: string) => text)
  const listeners = new Map<string, Set<(change: InboxChange) => void>>()
  let queue: Job[] = []
  let draining: Promise<void> | null = null
  let closed = false
  // A failure report must never become the failure: during a teardown race the logger itself can
  // already be gone, and a throw here would escape the drain as an unhandled rejection.
  const log = (event: string, detail: Record<string, unknown>) => {
    try {
      deps.log?.(event, detail)
    } catch {
      /* the log sink is closed; the job's own `fail` still reports */
    }
  }

  const scrub = (userId: string, fact: RaiseFact): RaiseFact => ({
    ...fact,
    title: redact(userId, fact.title),
    body: fact.body === undefined ? undefined : redact(userId, fact.body),
    trace: fact.trace?.map((step) => ({ ...step, summary: redact(userId, step.summary) })),
  })

  async function applyOne(
    trx: Transaction<AppDatabase>,
    job: Job,
    at: number,
  ): Promise<InboxChange[]> {
    const { userId, source, op } = job
    if (job.opId && !(await repo.claimOp(trx, userId, job.opId))) return []
    const changes: InboxChange[] = []
    const write = async (transition: ReturnType<typeof raise>, payload: unknown, when = at) => {
      if (transition) changes.push(await repo.write(trx, userId, source, transition, payload, when))
    }
    switch (op.kind) {
      case 'raise': {
        const fact = scrub(userId, op.fact)
        const when = fact.occurredAt ?? at
        const existing = await repo.get(trx, userId, fact.key)
        if (!existing && fact.coalesce) {
          const candidates = await repo.repeatCandidates(trx, userId, fact.title)
          const same = candidates.find((candidate) => isRepeatOf(candidate, fact, at))
          if (same) {
            await write(repeat(same, fact, at), { key: fact.key }, when)
            break
          }
        }
        await write(raise(existing, fact, at), fact, when)
        break
      }
      case 'settle': {
        const { fact } = op
        const targets = fact.key
          ? [await repo.get(trx, userId, fact.key)].filter((entry) => entry !== undefined)
          : await repo.openUnderPrefix(trx, userId, fact.prefix!)
        for (const entry of targets) {
          if (entry.key === fact.keep) continue
          await write(
            settle(entry, fact.reason, at),
            { reason: fact.reason },
            fact.occurredAt ?? at,
          )
        }
        break
      }
      case 'read':
        for (const key of op.keys) {
          const entry = await repo.get(trx, userId, key)
          if (entry) await write(read(entry, at), {})
        }
        break
      case 'read_through':
        for (const entry of await repo.all(trx, userId)) {
          if (entry.seq <= op.seq) await write(read(entry, at), { through: op.seq })
        }
        break
      case 'remove': {
        const change = await repo.remove(trx, userId, source, op.key, at)
        if (change) changes.push(change)
        break
      }
      case 'clear': {
        for (const entry of await repo.all(trx, userId)) {
          if (isPending(entry)) continue
          const change = await repo.remove(trx, userId, source, entry.key, at)
          if (change) changes.push(change)
        }
        break
      }
    }
    return changes
  }

  function publish(userId: string, changes: readonly InboxChange[]) {
    const subscribers = listeners.get(userId)
    if (!subscribers) return
    for (const change of changes) {
      for (const listener of subscribers) {
        try {
          listener(change)
        } catch {
          /* one bad subscriber never breaks the journal */
        }
      }
    }
  }

  async function drain(): Promise<void> {
    // Yield once so every fact recorded in the same tick joins the first transaction.
    await Promise.resolve()
    while (queue.length > 0) {
      const batch = queue
      queue = []
      const at = now()
      let results: InboxChange[][] = []
      try {
        results = await retrySqliteBusy(() =>
          repo.transaction(async (trx) => {
            const out: InboxChange[][] = []
            for (const job of batch) out.push(await applyOne(trx, job, at))
            return out
          }),
        )
      } catch (error) {
        // One poisoned op must not lose the rest of the batch: retry each on its own.
        results = []
        for (const job of batch) {
          try {
            results.push(await repo.transaction((trx) => applyOne(trx, job, at)))
          } catch (jobError) {
            results.push([])
            log('notifications.write_failed', {
              op: job.op.kind,
              error: String(jobError instanceof Error ? jobError.message : jobError),
              batchError: String(error instanceof Error ? error.message : error),
            })
            job.fail?.(jobError)
            job.fail = undefined
          }
        }
      }
      batch.forEach((job, index) => {
        const changes = results[index] ?? []
        publish(job.userId, changes)
        job.done?.(changes)
      })
    }
  }

  // One drain at a time. A job queued after the loop saw an empty queue but before `finally` ran
  // would otherwise wait for the next unrelated record, so `finally` re-schedules.
  function schedule() {
    draining ??= drain().finally(() => {
      draining = null
      if (queue.length > 0) schedule()
    })
  }

  function enqueue(job: Job) {
    if (closed) {
      job.fail?.(new Error('The notification journal is closed'))
      return
    }
    queue.push(job)
    schedule()
  }

  async function flush(): Promise<void> {
    while (draining) await draining
  }

  const toOp = (op: ClientJournalOp): Op =>
    op.op === 'raise'
      ? { kind: 'raise', fact: op.fact }
      : op.op === 'settle'
        ? { kind: 'settle', fact: op.fact }
        : op.op === 'read'
          ? { kind: 'read', keys: op.keys }
          : op.op === 'read_through'
            ? { kind: 'read_through', seq: op.seq }
            : op.op === 'remove'
              ? { kind: 'remove', key: op.key }
              : { kind: 'clear' }

  return {
    record(userId, fact) {
      enqueue({ userId, source: 'server', op: { kind: 'raise', fact } })
    },
    settle(userId, fact) {
      enqueue({ userId, source: 'server', op: { kind: 'settle', fact } })
    },
    apply(userId, ops) {
      return Promise.all(
        ops.map(
          (op) =>
            new Promise<InboxChange[]>((resolve, reject) =>
              enqueue({
                userId,
                source: 'client',
                op: toOp(op),
                opId: op.id,
                done: resolve,
                fail: reject,
              }),
            ),
        ),
      ).then((all) => all.flat())
    },
    sync: (userId, since) => repo.sync(userId, since),
    subscribe(userId, listener) {
      let set = listeners.get(userId)
      if (!set) listeners.set(userId, (set = new Set()))
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(userId)
      }
    },
    flush,
    async close() {
      closed = true
      await flush()
    },
    async prune() {
      // Behind everything already queued, and as its own transaction: retention must never run
      // between a fact's event and its projection.
      await flush()
      const removed = await retrySqliteBusy(() =>
        repo.transaction((trx) => pruneJournal(trx, repo, now())),
      )
      let count = 0
      for (const [userId, changes] of removed) {
        publish(userId, changes)
        count += changes.length
      }
      return count
    },
    repository: repo,
  }
}
