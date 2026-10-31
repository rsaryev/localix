import type { QueuePromoteResult } from '../../contracts'
import type { DeadLetter } from './dead-letter'
import { holdLeases, type LeaseOperations, type WakeQueueSharedState } from './leases'

interface PromoteDependencies {
  leases: LeaseOperations
  deadLetter: Pick<DeadLetter, 'retry'>
  scheduleDrain: (
    sessionId: string,
    options?: { ownsDrainLease?: boolean; preferredItemId?: string; preclaimedItemId?: string },
  ) => void
  onError: (error: unknown) => void
}

export const createPromoteOperations = (
  shared: WakeQueueSharedState,
  { leases, deadLetter, scheduleDrain, onError }: PromoteDependencies,
) => {
  const { drainingSessions } = shared

  /**
   * Atomically turn one selected queued user/control item into the next run.
   *
   * The ordering is deliberate: reserve the session drain + durable item first,
   * then interrupt the active run, then transfer both leases to the normal queue
   * delivery path. A failed interrupt releases both leases, so there is no
   * remove-before-stop loss window. The old run's teardown cannot start a
   * competing drain because `drainingSessions` is already owned here.
   */
  const interruptAndPromote = async (
    userId: string,
    sessionId: string,
    itemId: string,
    interrupt: () => Promise<unknown>,
  ): Promise<QueuePromoteResult> => {
    // An agent ticket's drain holds the session lease until the run ends. Borrow
    // that drain for the hand-off instead of refusing every send-now during a
    // ticket run (the common case). A drain with no active run is selecting a row
    // right now and must not be displaced.
    const existingDrain = drainingSessions.has(sessionId)
    if (
      shared.promotingSessions.has(sessionId) ||
      shared.pendingPromotions.has(sessionId) ||
      (existingDrain && !shared.activeRuns.has(sessionId))
    ) {
      return { promoted: false, reason: 'leased' }
    }
    shared.promotingSessions.add(sessionId)
    if (!existingDrain) drainingSessions.add(sessionId)
    let itemClaimed = false
    let transferredToDrain = false
    try {
      await leases.ready
      // The borrowed drain may have finished while the durable store initialized.
      if (existingDrain && (!drainingSessions.has(sessionId) || !shared.activeRuns.has(sessionId)))
        return { promoted: false, reason: 'leased' }
      const item = shared.queues
        .get(sessionId)
        ?.list()
        .find((candidate) => candidate.id === itemId)
      if (!item || item.value.userId !== userId) return { promoted: false, reason: 'not_found' }
      // Send-now on a FAILED entry is its retry: it goes back in line, batch and all, without
      // stopping anything (`dead-letter.ts`). A wake may be retried too — nothing reinterprets it.
      if (item.value.failure)
        return (await deadLetter.retry(userId, sessionId, itemId))
          ? { promoted: true }
          : { promoted: false, reason: 'not_found' }
      // Internal wakes carry trusted execution context and must never be
      // reinterpreted as an operator-authored turn by a queue UI action.
      if (item.value.kind === 'wake') return { promoted: false, reason: 'not_user' }
      if (leases.isLeased(sessionId, itemId)) return { promoted: false, reason: 'leased' }
      // A batch claimed before is one delivery under its name's transcript ids: sending one
      // of its entries alone would acknowledge the rest without their text (`selection.ts`).
      if (item.value.batch) return { promoted: false, reason: 'batched' }

      holdLeases(shared, sessionId, [itemId], 'drain')
      if (!(await leases.claim(userId, sessionId, [itemId]))) {
        leases.releaseDrainBand(sessionId, [itemId])
        return { promoted: false, reason: 'leased' }
      }
      itemClaimed = true

      // The drain can end while the durable claim is in flight. Never strand a
      // preclaimed row in a hand-off that no drain remains to receive.
      if (
        existingDrain &&
        (!drainingSessions.has(sessionId) || !shared.activeRuns.has(sessionId))
      ) {
        await leases.release(userId, sessionId, [itemId]).catch(onError)
        leases.releaseDrainBand(sessionId, [itemId])
        itemClaimed = false
        scheduleDrain(sessionId)
        return { promoted: false, reason: 'leased' }
      }
      if (existingDrain) shared.pendingPromotions.set(sessionId, itemId)
      await interrupt()

      // Transfer ownership before detaching. The delivery is durable from this
      // point; a crash leaves a recoverable leased row rather than lost content.
      transferredToDrain = true
      if (!existingDrain) {
        scheduleDrain(sessionId, {
          ownsDrainLease: true,
          preferredItemId: itemId,
          preclaimedItemId: itemId,
        })
      }
      return { promoted: true }
    } catch (error) {
      if (shared.pendingPromotions.get(sessionId) === itemId)
        shared.pendingPromotions.delete(sessionId)
      if (itemClaimed) await leases.release(userId, sessionId, [itemId]).catch(onError)
      leases.releaseDrainBand(sessionId, [itemId])
      throw error
    } finally {
      shared.promotingSessions.delete(sessionId)
      if (!transferredToDrain && !existingDrain) {
        drainingSessions.delete(sessionId)
        // Retry the drain we were suppressing. This lease is held across the interrupt, and
        // the dying run's own end-of-run drain no-ops while any session holds it (see
        // drain.ts) — fire-and-forget, with no retry of its own. So every exit that does NOT
        // hand ownership to a drain (the row vanished, it turned out to be an internal wake,
        // another lease won it, or the interrupt threw — a stop that timed out) would leave
        // the rest of the queue waiting for an unrelated enqueue or a process restart. Same
        // shape, and the same reason, as `withSessionIdleLease` in agent-runner-queue.ts.
        scheduleDrain(sessionId)
      }
    }
  }

  return { interruptAndPromote }
}
