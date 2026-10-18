import type { Transaction } from 'kysely'

import type { AppDatabase } from '../../db/types'
import { retrySqliteBusy } from '../../db/seq'
import { createBatchWriter } from '../../lib/batch-writer'
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
 * never await, never throw, and never slow a run down. The shared single writer
 * (`lib/batch-writer.ts`) commits them in order, a batch per transaction. The window a crash can
 * lose is the batch in flight; facts with a durable source of their own are re-recorded at boot,
 * and the projection's idempotency (`projection.ts`) makes that safe.
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

  const writer = createBatchWriter<AppDatabase, Job, InboxChange[]>({
    transaction: (run) => repo.transaction(run),
    apply: applyOne,
    retry: retrySqliteBusy,
    settled(job, outcome) {
      if ('error' in outcome) return job.fail?.(outcome.error)
      publish(job.userId, outcome.result)
      job.done?.(outcome.result)
    },
    log: deps.log,
    failureEvent: 'notifications.write_failed',
    describe: (job) => ({ op: job.op.kind }),
    now,
  })

  function enqueue(job: Job) {
    if (!writer.enqueue(job)) job.fail?.(new Error('The notification journal is closed'))
  }

  const flush = () => writer.flush()

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
    close: () => writer.close(),
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
