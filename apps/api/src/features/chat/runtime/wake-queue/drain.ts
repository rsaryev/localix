import type { QueueItem } from '../../../../lib/priority-queue'
import { dispatchAgentTicket } from './dispatch-agent'
import type { RunExecutionOutcome } from '../run-outcome'
import type { DrainDependencies, DrainOptions } from './drain-contracts'
import { deliverBand } from './drain-delivery'
import { createDrainScheduler } from './drain-scheduler'
import { ticketOf, type PendingTurn } from './entry'
import { holdLeases, type WakeQueueSharedState } from './leases'
import { selectDrainBand } from './selection'

export type { DrainOptions } from './drain-contracts'

function fatalDrainOutcome(error: unknown): RunExecutionOutcome {
  return {
    status: 'failed',
    kind: 'fatal',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    rateLimited: false,
  }
}

export function createDrainOperations(
  shared: WakeQueueSharedState,
  dependencies: DrainDependencies,
) {
  const {
    repo,
    store,
    streamRegistry,
    now,
    run,
    ready,
    onError = console.warn,
    leases,
    continuations,
    publishQueue,
    ageWaitingAgentTurns,
    holdsOf,
    holdUntil,
    deadLetter,
  } = dependencies

  const drainPendingAndRunImpl = async (
    sessionId: string,
    options: DrainOptions = {},
  ): Promise<void> => {
    if (shared.closed) return
    if (!options.ownsDrainLease) {
      if (shared.activeRuns.has(sessionId) || shared.drainingSessions.has(sessionId)) return
    } else if (!shared.drainingSessions.has(sessionId)) {
      return
    }
    // Win the in-process drain lease before the first await. This preserves the
    // isBusy ordering guarantee while startup hydration is still in flight.
    if (!options.ownsDrainLease) shared.drainingSessions.add(sessionId)
    let preferredItemId = options.preferredItemId
    try {
      await ready
      if (shared.closed) return
      const q = shared.queues.get(sessionId)
      if (!q || q.size() === 0) return
      while (!shared.closed && !shared.activeRuns.has(sessionId) && q.size() > 0) {
        // Send-now can borrow this drain while its agent ticket is running. The
        // interrupt has settled by the time we return here; select its exact
        // already-claimed row before any older queued work.
        const promotedId = shared.pendingPromotions.get(sessionId)
        if (promotedId) {
          preferredItemId = promotedId
          shared.pendingPromotions.delete(sessionId)
        }
        // Reserve the top band so failed delivery remains visible and retryable. Held entries
        // wait (`holds.ts`): when only they are left, this pass ends and wakes again by their
        // deadline, or sooner when what they wait for settles.
        const held = holdsOf(sessionId)
        const band: QueueItem<PendingTurn>[] = selectDrainBand(q.list(), {
          preferredItemId,
          held: held.ids,
        })
        preferredItemId = undefined
        if (band.length === 0) {
          if (held.releaseAt !== undefined) holdUntil(sessionId, held.releaseAt)
          return
        }
        // Lease synchronously BEFORE the first await. A remove/clear that reports
        // success must never race this snapshotted band into durable execution.
        const bandIds = band.map((item) => item.id)
        holdLeases(shared, sessionId, bandIds, 'drain')
        const next = band[0]!.value
        const stillQueued = () => bandIds.some((id) => q.list().some((item) => item.id === id))
        // Durable acknowledgement precedes this synchronous local retirement.
        const retireAcknowledgedBand = (): void => {
          for (const item of band) q.remove(item.id)
          deadLetter.delivered(bandIds)
          leases.resetDrainRetry(sessionId)
          leases.releaseDrainBand(sessionId, bandIds)
          publishQueue(next.userId, sessionId)
        }
        let stopRenewal = () => {}
        try {
          if (
            !(bandIds.length === 1 && (promotedId ?? options.preclaimedItemId) === bandIds[0]) &&
            !(await leases.claim(next.userId, sessionId, bandIds))
          ) {
            // Another process owns the durable delivery. This process cannot
            // observe its terminal run, but admission is no longer stuck here.
            // Treat the hand-off as a continuation rather than inventing a
            // failure that could cause the scheduler to duplicate the work.
            continuations.settleCompletion(bandIds, {
              status: 'delegated',
              message: 'Queued work is owned by another runtime process.',
            })
            leases.releaseDrainBand(sessionId, bandIds)
            // Look again when that owner's lease runs out, in case it died holding it.
            await leases.awaitForeignLease(next.userId, sessionId, bandIds).catch(onError)
            return
          }
          // Delivery can outlast one lease (recipient resolution, slow writes): keep it held.
          stopRenewal = leases.keepAlive(next.userId, sessionId, bandIds)
          const latestSession = await repo.getSession(next.userId, sessionId)
          if (!latestSession) {
            continuations.settleCompletion(
              q.list().map((queued) => queued.id),
              {
                status: 'failed',
                kind: 'dismissed',
                message: `Session ${sessionId} was removed before its queued run started.`,
                retryable: false,
                rateLimited: false,
              },
            )
            leases.releaseDrainBand(sessionId, bandIds)
            shared.queues.delete(sessionId)
            publishQueue(next.userId, sessionId)
            return
          }
          // A CLOSED child is never woken again (`subagent-close.ts`). Its close clears the queue,
          // but a wake admitted a moment before the mark landed still reaches this line, and this
          // is the one door every queued turn passes: dismiss it here, before any row is minted.
          if (latestSession.closedAt) {
            if (!(await leases.ack(next.userId, sessionId, bandIds)))
              throw new Error('Delivery lost its durable lease')
            retireAcknowledgedBand()
            continuations.settleCompletion(bandIds, {
              status: 'failed',
              kind: 'dismissed',
              message: 'The session was closed; nothing wakes it again.',
              retryable: false,
              rateLimited: false,
            })
            continue
          }
          const ticket = ticketOf(next)
          if (ticket) {
            await ageWaitingAgentTurns(next.userId, sessionId)
            const completion = continuations.bandCompletion(bandIds, sessionId)
            let outcome: RunExecutionOutcome
            try {
              outcome = await dispatchAgentTicket(
                {
                  userId: next.userId,
                  session: latestSession,
                  ticket,
                  completion,
                  consume: async (starting) => {
                    stopRenewal()
                    if (!(await leases.ack(next.userId, sessionId, bandIds, starting)))
                      throw new Error('Agent ticket lost its lease')
                    deadLetter.delivered(bandIds)
                    for (const id of bandIds) q.remove(id)
                    leases.releaseDrainBand(sessionId, bandIds)
                    leases.resetDrainRetry(sessionId)
                    publishQueue(next.userId, sessionId)
                  },
                },
                { repo, run, streamRegistry, now, store },
              )
            } catch (error) {
              if (stillQueued()) throw error
              onError(error)
              outcome = fatalDrainOutcome(error)
            }
            continuations.settleCompletion(bandIds, outcome)
            continue
          }
          const step = await deliverBand(shared, dependencies, {
            sessionId,
            band,
            session: latestSession,
            retire: retireAcknowledgedBand,
            stillQueued,
          })
          if (step === 'stop') return
        } catch (error) {
          // A head that fails every attempt is parked as failed so the rest of the queue moves.
          if (
            stillQueued() &&
            (await deadLetter
              .recordFailure(next.userId, sessionId, bandIds, error)
              .catch((parkError: unknown) => (onError(parkError), false)))
          ) {
            leases.releaseDrainBand(sessionId, bandIds)
            onError(error)
            leases.resetDrainRetry(sessionId)
            continuations.settleCompletion(bandIds, fatalDrainOutcome(error))
            continue
          }
          await leases.release(next.userId, sessionId, bandIds).catch(onError)
          leases.releaseDrainBand(sessionId, bandIds)
          onError(error)
          // Before the preamble is acknowledged the durable item remains
          // retryable, so its completion must remain pending. Once the item has
          // left the queue there is no retry owner and the failure is terminal.
          if (!stillQueued()) {
            continuations.settleCompletion(bandIds, fatalDrainOutcome(error))
          }
          leases.scheduleDrainRetry(sessionId)
          return
        } finally {
          stopRenewal()
        }
      }
    } catch (error) {
      // In addition to scheduler-owned drains, run teardown invokes this method
      // fire-and-forget. Contain a failed startup barrier here so neither path can
      // become a process-level unhandled rejection.
      onError(error)
    } finally {
      shared.drainingSessions.delete(sessionId)
    }
  }

  return createDrainScheduler(shared, onError, drainPendingAndRunImpl)
}

export type DrainOperations = ReturnType<typeof createDrainOperations>
