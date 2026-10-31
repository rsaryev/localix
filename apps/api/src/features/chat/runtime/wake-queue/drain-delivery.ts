/**
 * THE DELIVERY STAGE: one claimed band becomes one turn of the conversation.
 *
 *   word the band (`kinds.ts`, render) → resolve the recipient by the band's route → dismiss it
 *   when nobody answers → write the turn's user row and first slot (ids from the band, so a
 *   replay writes the same rows) → one ticket for the conversation's agent → acknowledge.
 *
 * The drain owns selection, the lease and the retry; this stage owns what the band says and to
 * whom. An error before acknowledgement leaves the band leased for the drain to release and retry.
 */
import type { QueueItem } from '../../../../lib/priority-queue'
import { agentAuthor } from '../../../../db/author'
import type { SessionRecord } from '../../repository'
import { enqueueTurnTicket } from '../conversation-dispatch'
import { turnRecipient } from '../conversation-strategy'
import { sessionExecutionContext } from '../execution-context'
import { insertInternalTurn } from '../message-persistence'
import { mergeIdentity } from '../run-params'
import {
  dismissedRun,
  fatalRun,
  createRunCompletion,
  type RunExecutionOutcome,
} from '../run-outcome'
import { queueDeliveryMessageIds } from '../wake-queue-repository'
import type { DrainDependencies } from './drain-contracts'
import { commandOf, type PendingTurn } from './entry'
import { renderBatch, routeEvent } from './kinds'
import type { WakeQueueSharedState } from './leases'

export interface ClaimedBand {
  sessionId: string
  band: readonly QueueItem<PendingTurn>[]
  session: SessionRecord
  /** Remove the acknowledged band from the in-memory queue and release its local lease. */
  retire: () => void
  /** Is any of the band still queued (not yet acknowledged)? */
  stillQueued: () => boolean
}

/** 'stop' ends this drain pass (the runtime is shutting down); 'next' selects the next band. */
export async function deliverBand(
  shared: WakeQueueSharedState,
  deps: DrainDependencies,
  claimed: ClaimedBand,
): Promise<'next' | 'stop'> {
  const {
    repo,
    streamRegistry,
    now,
    state,
    store,
    leases,
    continuations,
    onError = console.warn,
  } = deps
  const { sessionId, band, retire } = claimed
  const session = claimed.session
  const bandIds = band.map((item) => item.id)
  const head = band[0]!.value
  const turns = band.map((item) => item.value)
  const content = renderBatch(turns)
  const extraDisabledTools = turns.some((turn) => turn.extraDisabledTools)
    ? [...new Set(turns.flatMap((turn) => turn.extraDisabledTools ?? []))]
    : undefined
  const bindings = turns.flatMap((turn) => turn.bindings ?? [])
  const miniApps = [...new Set(turns.flatMap((turn) => turn.miniApps ?? []))]
  const sources = new Set(turns.map((turn) => turn.source).filter(Boolean))
  const origin = sources.size === 1 ? [...sources][0] : undefined
  const command = commandOf(head)

  // Resolve the recipient before creating the immutable assistant author slot.
  const recipient = turnRecipient(session, routeEvent(head, content))
  // A session without an agent answers nothing: dismissed BEFORE any row is minted, since a slot
  // created for it would stay an empty assistant turn in the transcript.
  if (!recipient) {
    if (!(await leases.ack(head.userId, sessionId, bandIds)))
      throw new Error('Delivery lost its durable lease')
    retire()
    continuations.settleCompletion(
      bandIds,
      dismissedRun('The session has no agent to answer this delivery.'),
    )
    return 'next'
  }
  const { userMessage, assistantMessage } = await insertInternalTurn({
    agent: agentAuthor(recipient.agentId),
    repo,
    streamRegistry,
    now,
    userId: head.userId,
    sessionId,
    content,
    internal: head.internal,
    ...(origin ? { origin } : {}),
    ...(command?.origin ? { commandOrigin: command.origin } : {}),
    ...(bindings.length > 0 ? { bindings } : {}),
    ...(miniApps.length > 0 ? { miniApps } : {}),
    clientMessageIds: turns.flatMap((turn) => (turn.clientMessageId ? [turn.clientMessageId] : [])),
    ...(store ? { messageIds: queueDeliveryMessageIds(head.batch ?? bandIds[0]!) } : {}),
  })
  if (shared.closed) {
    continuations.settleCompletion(bandIds, {
      status: 'failed',
      kind: 'abort',
      message: 'Runtime shut down before the queued run started.',
      retryable: true,
      rateLimited: false,
    })
    await leases.release(head.userId, sessionId, bandIds).catch(onError)
    leases.releaseDrainBand(sessionId, bandIds)
    return 'stop'
  }
  let outcome: RunExecutionOutcome
  const completion = continuations.bandCompletion(bandIds, sessionId) ?? createRunCompletion()
  // A continued physical segment returns immediately so this drain can admit its queued child.
  // The shared completion resolves the original waiter only when that child (or a later
  // descendant) is terminal.
  void completion.promise.then(() => continuations.detachContinuations(bandIds))
  // Convert the recipient into an addressed ticket; the event loop consumes it through the
  // same path as acknowledge and runtime producers.
  try {
    await enqueueTurnTicket(deps.enqueueRun, {
      userId: head.userId,
      session,
      triggerMessageIds: [userMessage.id],
      firstSlotId: assistantMessage.id,
      recipient,
      completion,
      scope: {
        // A remembered task identity can narrow this run, but the session's agent is the
        // concrete address. Authority is always re-derived.
        ...mergeIdentity(state.sessionRunIdentity.get(sessionId), {
          ...(extraDisabledTools ? { extraDisabledTools } : {}),
          ...command?.identity,
        }),
        executionContext:
          head.executionContext ?? sessionExecutionContext(session, head.toolSurface, origin),
        conversationId: userMessage.id,
      },
    })
    // Checkpoint delivery only after the execution ticket is durable. Retrying an interrupted
    // delivery uses the same assistant ids and cannot duplicate it.
    if (!(await leases.ack(head.userId, sessionId, bandIds)))
      throw new Error('Delivery lost its durable lease')
    retire()
    outcome = { status: 'continued' }
  } catch (error) {
    if (claimed.stillQueued()) throw error
    onError(error)
    outcome = fatalRun(error)
  }
  if (outcome.status !== 'continued') completion.settle(outcome)
  continuations.settleCompletion(bandIds, outcome)
  return 'next'
}
