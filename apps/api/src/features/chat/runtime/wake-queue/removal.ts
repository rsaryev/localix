/**
 * TAKING QUEUED WORK BACK: the person's remove (a line returned to the composer, a wake deleted)
 * and clear.
 *
 * What anyone holds (`leases.ts`) is being delivered and stays. An entry claimed in a BATCH before
 * (`entry.ts`, `batch`) is one delivery with the rest of its batch, so it leaves only with all of
 * them: a lone remove answers `batched` with the batch's size, and the person may then remove the
 * whole batch (`wholeBatch`). Clear takes whole batches nobody holds. A failed entry
 * (`dead-letter.ts`) is removable like a pending one.
 */
import type { QueueItem } from '../../../../lib/priority-queue'
import type { QueueClearResult, QueueRemovalResult } from '../../contracts'
import type { WakeQueueStore } from '../wake-queue-store'
import type { ContinuationOperations } from './continuations'
import type { PendingTurn } from './entry'
import { renderBatch } from './kinds'
import type { LeaseOperations, WakeQueueSharedState } from './leases'

interface RemovalDependencies {
  store?: WakeQueueStore<PendingTurn>
  ready: Promise<void>
  leases: Pick<LeaseOperations, 'isLeased'>
  continuations: Pick<ContinuationOperations, 'settleCompletion'>
  publishQueue: (userId: string, sessionId: string) => void
}

export interface RemoveOptions {
  /** Remove every entry of the item's batch with it. */
  wholeBatch?: boolean
}

export const createRemovalOperations = (
  shared: WakeQueueSharedState,
  { store, ready, leases, continuations, publishQueue }: RemovalDependencies,
) => {
  /** The entries `item` leaves the queue with: its batch, or itself. */
  const bandOf = (sessionId: string, item: QueueItem<PendingTurn>) =>
    item.value.batch
      ? (shared.queues.get(sessionId)?.list() ?? []).filter(
          (other) => other.value.batch === item.value.batch,
        )
      : [item]
  const held = (sessionId: string, band: readonly QueueItem<PendingTurn>[]) =>
    band.some((entry) => leases.isLeased(sessionId, entry.id))
  const removeDurable = async (userId: string, sessionId: string, ids: readonly string[]) =>
    !store ||
    (ids.length === 1
      ? store.remove(userId, sessionId, ids[0]!)
      : store.removeMany(userId, sessionId, ids))

  const dismiss = (sessionId: string, band: readonly QueueItem<PendingTurn>[], message: string) => {
    const q = shared.queues.get(sessionId)
    for (const entry of band) q?.remove(entry.id)
    continuations.settleCompletion(
      band.map((entry) => entry.id),
      { status: 'failed', kind: 'dismissed', message, retryable: false, rateLimited: false },
    )
  }

  /** Remove a queued item (with its batch, when asked) and return its content for the composer. */
  const remove = async (
    userId: string,
    sessionId: string,
    itemId: string,
    options: RemoveOptions = {},
  ): Promise<QueueRemovalResult> => {
    if (store) await ready
    const item = shared.queues
      .get(sessionId)
      ?.list()
      .find((candidate) => candidate.id === itemId)
    if (!item) return { removed: false, reason: 'not_found' }
    // Once delivery or steering persistence starts, cancellation would race a durable row that
    // may already have committed. The chip disappears on acknowledgement instead.
    const band = bandOf(sessionId, item)
    if (held(sessionId, band)) return { removed: false, reason: 'leased' }
    if (band.length > 1 && !options.wholeBatch)
      return { removed: false, reason: 'batched', batchSize: band.length }
    const ids = band.map((entry) => entry.id)
    // The durable delete is the arbiter: a drain that took the rows meanwhile loses its claim.
    if (!(await removeDurable(userId, sessionId, ids))) return { removed: false, reason: 'leased' }
    dismiss(sessionId, band, 'Queued run was cancelled before execution.')
    publishQueue(userId, sessionId)
    const turns = band.map((entry) => entry.value)
    const bindings = turns.flatMap((turn) => turn.bindings ?? [])
    return {
      removed: true,
      content: turns.length === 1 ? turns[0]!.content : renderBatch(turns),
      ...(bindings.length ? { bindings } : {}),
    }
  }

  /** Clear every cancellable item and batch; what anyone holds stays and is reported. */
  const clear = async (userId: string, sessionId: string): Promise<QueueClearResult> => {
    if (store) await ready
    const q = shared.queues.get(sessionId)
    if (!q) return { removed: 0, retained: [] }
    let removed = 0
    const retained: string[] = []
    const seen = new Set<string>()
    for (const item of q.list()) {
      if (seen.has(item.id)) continue
      const band = bandOf(sessionId, item)
      const ids = band.map((entry) => entry.id)
      for (const id of ids) seen.add(id)
      if (held(sessionId, band) || !(await removeDurable(userId, sessionId, ids))) {
        retained.push(...ids)
        continue
      }
      dismiss(sessionId, band, 'Queued run was cleared before execution.')
      removed += band.length
    }
    if (removed > 0) publishQueue(userId, sessionId)
    return { removed, retained }
  }

  return { remove, clear }
}
