import type { QueueItem } from '../../../../lib/priority-queue'
import { insertInternalTurn } from '../message-persistence'
import { agentParticipant } from '../../../../db/participant'
import {
  enqueueTurnTickets,
  queuedTurnEvent,
  resolveTurnRecipients,
  supersedeColleagueChains,
} from '../conversation-dispatch'
import { noLeadership } from '../conversation-strategy'
import { dispatchAgentTicket } from './dispatch-agent'
import { sessionExecutionContext } from '../execution-context'
import { mergeIdentity } from '../run-params'
import { createRunCompletion, type RunExecutionOutcome } from '../run-outcome'
import { selectDrainBand, bandRecipient } from '../wake-queue-selection'
import { queueDeliveryMessageIds } from '../wake-queue-store'
import type { PendingTurn, WakeQueueSharedState } from './leases'
import type { DrainDependencies, DrainOptions } from './drain-contracts'
import { createDrainScheduler } from './drain-scheduler'

export type { DrainOptions } from './drain-contracts'

export function createDrainOperations(
  shared: WakeQueueSharedState,
  dependencies: DrainDependencies,
) {
  const {
    repo,
    streamRegistry,
    now,
    state,
    run,
    enqueueRun,
    store,
    ready,
    onError = console.warn,
    leases,
    continuations,
    publishQueue,
    ageWaitingAgentTurns,
    cancelAgentTurns,
    leadership,
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
        // Reserve the top band so failed delivery remains visible and retryable.
        const selectedBand = selectDrainBand(q.list(), {
          preferredItemId,
          durable: Boolean(store),
        })
        preferredItemId = undefined
        const band: QueueItem<PendingTurn>[] = selectedBand
        // Lease synchronously BEFORE the first await. A remove/clear that reports
        // success must never race this snapshotted band into durable execution.
        const bandIds = band.map((item) => item.id)
        const drainLeases = shared.leasedDrainIds.get(sessionId) ?? new Set<string>()
        for (const id of bandIds) drainLeases.add(id)
        shared.leasedDrainIds.set(sessionId, drainLeases)
        const next = band[0]!.value // derive AFTER binding isolation
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
            return
          }
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
            for (const item of band) q.remove(item.id)
            leases.resetDrainRetry(sessionId)
            leases.releaseDrainBand(sessionId, bandIds)
            publishQueue(next.userId, sessionId)
            continuations.settleCompletion(bandIds, {
              status: 'failed',
              kind: 'dismissed',
              message: 'The session was closed; nothing wakes it again.',
              retryable: false,
              rateLimited: false,
            })
            continue
          }
          if (next.agentTurn) {
            await ageWaitingAgentTurns(next.userId, sessionId)
            const completion = continuations.bandCompletion(bandIds, sessionId)
            let outcome: RunExecutionOutcome
            try {
              outcome = await dispatchAgentTicket(
                {
                  userId: next.userId,
                  session: latestSession,
                  ticket: next.agentTurn,
                  completion,
                  consume: async () => {
                    if (!(await leases.ack(next.userId, sessionId, bandIds)))
                      throw new Error('Agent ticket lost its lease')
                    for (const id of bandIds) q.remove(id)
                    leases.releaseDrainBand(sessionId, bandIds)
                    leases.resetDrainRetry(sessionId)
                    publishQueue(next.userId, sessionId)
                  },
                },
                { repo, run, streamRegistry, now },
              )
            } catch (error) {
              if (bandIds.some((id) => q.list().some((item) => item.id === id))) throw error
              onError(error)
              outcome = {
                status: 'failed',
                kind: 'fatal',
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
                rateLimited: false,
              }
            }
            continuations.settleCompletion(bandIds, outcome)
            continue
          }
          const content =
            band.length === 1
              ? band[0]!.value.content
              : band.map((item) => item.value.content).join('\n\n---\n\n')
          const extraDisabledTools = band.some((item) => item.value.extraDisabledTools)
            ? [...new Set(band.flatMap((item) => item.value.extraDisabledTools ?? []))]
            : undefined
          const bindings = band.flatMap((item) => item.value.bindings ?? [])
          const plugins = [...new Set(band.flatMap((item) => item.value.plugins ?? []))]
          const sources = new Set(band.map((item) => item.value.source).filter(Boolean))
          const origin = sources.size === 1 ? [...sources][0] : undefined
          const routedTo = bandRecipient(band.map((item) => item.value))
          // Resolve recipients before creating the immutable assistant author slot. A wake that
          // carries the person's words (`addressedAs`, alone in its band) is routed as their
          // message with that text (`queuedTurnEvent`), and so — like one — supersedes the
          // colleague chains queued before it.
          const history = await repo.listMessages(next.userId, sessionId)
          const personal = next.internal && next.addressedAs !== undefined
          const recipients = await resolveTurnRecipients(
            latestSession,
            history,
            queuedTurnEvent(
              { internal: next.internal, content, addressedAs: next.addressedAs },
              routedTo?.participant,
            ),
            leadership?.(next.userId, latestSession.projectId) ?? noLeadership,
          )
          // A delivery no current participant answers (its addressee left the conversation)
          // is dismissed BEFORE any row is minted: a slot created for it would stay an empty
          // assistant turn in the transcript.
          if (recipients.length === 0) {
            if (!(await leases.ack(next.userId, sessionId, bandIds)))
              throw new Error('Delivery lost its durable lease')
            for (const item of band) q.remove(item.id)
            leases.resetDrainRetry(sessionId)
            leases.releaseDrainBand(sessionId, bandIds)
            publishQueue(next.userId, sessionId)
            continuations.settleCompletion(bandIds, {
              status: 'failed',
              kind: 'dismissed',
              message: 'No current participant matches this delivery.',
              retryable: false,
              rateLimited: false,
            })
            continue
          }
          if (!next.internal || personal)
            await supersedeColleagueChains(cancelAgentTurns, next.userId, sessionId)
          const firstSlot = recipients[0]!.agentId
          const { userMessage, assistantMessage } = await insertInternalTurn({
            agent: agentParticipant(firstSlot),
            repo,
            streamRegistry,
            now,
            userId: next.userId,
            sessionId,
            content,
            internal: next.internal,
            ...(origin ? { origin } : {}),
            ...(next.command?.origin ? { commandOrigin: next.command.origin } : {}),
            ...(routedTo ? { to: routedTo } : {}),
            ...(bindings.length > 0 ? { bindings } : {}),
            ...(plugins.length > 0 ? { plugins } : {}),
            clientMessageIds: band
              .map((item) => item.value.clientMessageId)
              .filter((id): id is string => Boolean(id)),
            ...(store ? { messageIds: queueDeliveryMessageIds(band[0]!.id) } : {}),
          })
          if (shared.closed) {
            continuations.settleCompletion(bandIds, {
              status: 'failed',
              kind: 'abort',
              message: 'Runtime shut down before the queued run started.',
              retryable: true,
              rateLimited: false,
            })
            await leases.release(next.userId, sessionId, bandIds).catch(onError)
            leases.releaseDrainBand(sessionId, bandIds)
            return
          }
          let outcome: RunExecutionOutcome
          const completion =
            continuations.bandCompletion(bandIds, sessionId) ?? createRunCompletion()
          if (completion) {
            // A continued physical segment returns immediately so this drain can
            // admit its queued child. The shared completion resolves the original
            // waiter only when that child (or a later descendant) is terminal.
            void completion.promise.then(() => continuations.detachContinuations(bandIds))
          }
          // Convert the strategy's recipients into addressed tickets; the event loop consumes
          // them one at a time through the same path as acknowledge and runtime producers.
          try {
            await enqueueTurnTickets(enqueueRun, {
              userId: next.userId,
              session: latestSession,
              triggerMessageIds: [userMessage.id],
              firstSlotId: assistantMessage.id,
              recipients,
              completion,
              scope: {
                // A remembered task identity can narrow this run, but the strategy owns its
                // concrete participant address. Authority is always re-derived.
                ...mergeIdentity(state.sessionRunIdentity.get(sessionId), {
                  ...(extraDisabledTools ? { extraDisabledTools } : {}),
                  ...next.command?.identity,
                }),
                executionContext:
                  next.executionContext ??
                  sessionExecutionContext(latestSession, next.toolSurface, origin),
                conversationId: userMessage.id,
              },
            })
            // Checkpoint delivery only after every execution ticket is durable. Retrying an
            // interrupted fan-out uses the same assistant ids and cannot duplicate a ticket.
            if (!(await leases.ack(next.userId, sessionId, bandIds)))
              throw new Error('Delivery lost its durable lease')
            for (const item of band) q.remove(item.id)
            leases.resetDrainRetry(sessionId)
            leases.releaseDrainBand(sessionId, bandIds)
            publishQueue(next.userId, sessionId)
            outcome = { status: 'continued' }
          } catch (error) {
            if (bandIds.some((id) => q.list().some((item) => item.id === id))) throw error
            onError(error)
            outcome = {
              status: 'failed',
              kind: 'fatal',
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
              rateLimited: false,
            }
          }
          if (outcome.status !== 'continued') completion?.settle(outcome)
          continuations.settleCompletion(bandIds, outcome)
        } catch (error) {
          await leases.release(next.userId, sessionId, bandIds).catch(onError)
          leases.releaseDrainBand(sessionId, bandIds)
          onError(error)
          // Before the preamble is acknowledged the durable item remains
          // retryable, so its completion must remain pending. Once the item has
          // left the queue there is no retry owner and the failure is terminal.
          const retryPending = bandIds.some((id) => q.list().some((item) => item.id === id))
          if (!retryPending) {
            continuations.settleCompletion(bandIds, {
              status: 'failed',
              kind: 'fatal',
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
              rateLimited: false,
            })
          }
          leases.scheduleDrainRetry(sessionId)
          return
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
