/**
 * A DELIVERY THAT FAILS EVERY TIME LEAVES THE HEAD.
 *
 * The drain retries a failed band (`leases.ts`, `scheduleDrainRetry`), and the queue is serial: a
 * head that throws on every attempt — an unreadable binding, a recipient that always errors —
 * used to be picked again by every later drain, so nothing queued behind it was ever delivered.
 * After `MAX_DELIVERY_FAILURES` consecutive failures the band is parked as FAILED instead: durable
 * (`state = 'failed'`), skipped by selection and steering, and listed in the queue snapshot so
 * the person sees it and retries or removes it. Retrying puts the whole band back where it was.
 */
import type { WakeQueueStore } from '../wake-queue-store'
import type { PendingTurn } from './entry'
import type { LeaseOperations, WakeQueueSharedState } from './leases'

export const MAX_DELIVERY_FAILURES = 3

interface DeadLetterDependencies {
  store?: WakeQueueStore<PendingTurn>
  leases: Pick<LeaseOperations, 'owner'>
  publishQueue: (userId: string, sessionId: string) => void
}

export function createDeadLetter(
  shared: WakeQueueSharedState,
  { store, leases, publishQueue }: DeadLetterDependencies,
) {
  /** Band head → consecutive failed delivery attempts. */
  const failures = new Map<string, number>()

  const mark = (sessionId: string, ids: readonly string[], failure: string | undefined) => {
    const q = shared.queues.get(sessionId)
    for (const item of q?.list() ?? []) {
      if (!ids.includes(item.id)) continue
      const { failure: _previous, ...rest } = item.value
      q!.update(item.id, (failure ? { ...rest, failure } : rest) as PendingTurn)
    }
  }

  /**
   * Count one failed attempt of a band this process still leases. True when it was parked: its
   * rows are no longer leased and the caller must not release them.
   */
  const recordFailure = async (
    userId: string,
    sessionId: string,
    ids: readonly string[],
    error: unknown,
  ): Promise<boolean> => {
    const key = ids[0]!
    const count = (failures.get(key) ?? 0) + 1
    if (count < MAX_DELIVERY_FAILURES) {
      failures.set(key, count)
      return false
    }
    failures.delete(key)
    const message = error instanceof Error ? error.message : String(error)
    if (store && !(await store.fail(userId, sessionId, ids, leases.owner, message))) return false
    mark(sessionId, ids, message)
    publishQueue(userId, sessionId)
    return true
  }

  /** The band was delivered: its earlier failures no longer count. */
  const delivered = (ids: readonly string[]): void => void failures.delete(ids[0]!)

  /** The entries a failed entry was parked with — its whole batch, or itself. */
  const bandOf = (sessionId: string, itemId: string): string[] => {
    const listed = shared.queues.get(sessionId)?.list() ?? []
    const item = listed.find((candidate) => candidate.id === itemId)
    if (!item?.value.batch) return [itemId]
    return listed.filter((other) => other.value.batch === item.value.batch).map((other) => other.id)
  }

  /** Put a failed entry, with its batch, back in line. False when it is not failed. */
  const retry = async (userId: string, sessionId: string, itemId: string): Promise<boolean> => {
    const ids = bandOf(sessionId, itemId)
    if (store && !(await store.retry(userId, sessionId, ids))) return false
    mark(sessionId, ids, undefined)
    publishQueue(userId, sessionId)
    return true
  }

  return { recordFailure, delivered, retry }
}

export type DeadLetter = ReturnType<typeof createDeadLetter>
