/**
 * THE DELIVERY STAGE: one claimed band becomes one turn of the conversation.
 *
 *   word the band (`kinds.ts`, render) → invite the agents the person's words tag → resolve the
 *   recipients by the band's route → dismiss it when nobody answers → drop colleague chains the
 *   person's words supersede → write the turn's user row and first slot (ids from the band, so a
 *   replay writes the same rows) → one ticket per recipient → acknowledge.
 *
 * The drain owns selection, the lease and the retry; this stage owns what the band says and to
 * whom. An error before acknowledgement leaves the band leased for the drain to release and retry.
 */
import type { QueueItem } from '../../../../lib/priority-queue'
import { agentParticipant } from '../../../../db/participant'
import type { SessionRecord } from '../../repository'
import {
  enqueueTurnTickets,
  resolveTurnRecipients,
  supersedeColleagueChains,
} from '../conversation-dispatch'
import { noLeadership } from '../conversation-strategy'
import { sessionExecutionContext } from '../execution-context'
import { insertInternalTurn } from '../message-persistence'
import { mergeIdentity } from '../run-params'
import { createRunCompletion, type RunExecutionOutcome } from '../run-outcome'
import { queueDeliveryMessageIds } from '../wake-queue-store'
import type { DrainDependencies } from './drain-contracts'
import { commandOf, type PendingTurn } from './entry'
import { personSpeaks, renderBatch, routeEvent } from './kinds'
import type { WakeQueueSharedState } from './leases'
import { bandRecipient } from './selection'

export interface ClaimedBand {
  sessionId: string
  band: readonly QueueItem<PendingTurn>[]
  session: SessionRecord
  /** Remove the acknowledged band from the in-memory queue and release its local lease. */
  retire: () => void
  /** Is any of the band still queued (not yet acknowledged)? */
  stillQueued: () => boolean
}

const dismissed = (message: string): RunExecutionOutcome => ({
  status: 'failed',
  kind: 'dismissed',
  message,
  retryable: false,
  rateLimited: false,
})

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
  let session = claimed.session
  const bandIds = band.map((item) => item.id)
  const head = band[0]!.value
  const turns = band.map((item) => item.value)
  const content = renderBatch(turns)
  const extraDisabledTools = turns.some((turn) => turn.extraDisabledTools)
    ? [...new Set(turns.flatMap((turn) => turn.extraDisabledTools ?? []))]
    : undefined
  const bindings = turns.flatMap((turn) => turn.bindings ?? [])
  const plugins = [...new Set(turns.flatMap((turn) => turn.plugins ?? []))]
  const sources = new Set(turns.map((turn) => turn.source).filter(Boolean))
  const origin = sources.size === 1 ? [...sources][0] : undefined
  const routedTo = bandRecipient(turns)
  const speaks = personSpeaks(head)
  const command = commandOf(head)

  // Resolve recipients before creating the immutable assistant author slot. When the person
  // speaks, the agents their words tag join first, so the address can reach them.
  const history = await repo.listMessages(head.userId, sessionId)
  const event = routeEvent(head, content, routedTo?.participant)
  if (deps.inviteAddressed && speaks && event.kind === 'user-message')
    session = await deps.inviteAddressed(head.userId, session, event.text)
  const recipients = await resolveTurnRecipients(
    session,
    history,
    event,
    deps.leadership?.(head.userId, session.projectId) ?? noLeadership,
    // Only the person's own words are advised on: a hidden webhook or wake text is not theirs.
    speaks
      ? deps.floorAdvisor?.({ userId: head.userId, sessionId, projectId: session.projectId })
      : undefined,
  )
  // A delivery no current participant answers (its addressee left the conversation) is
  // dismissed BEFORE any row is minted: a slot created for it would stay an empty assistant
  // turn in the transcript.
  if (recipients.length === 0) {
    if (!(await leases.ack(head.userId, sessionId, bandIds)))
      throw new Error('Delivery lost its durable lease')
    retire()
    continuations.settleCompletion(
      bandIds,
      dismissed('No current participant matches this delivery.'),
    )
    return 'next'
  }
  if (speaks) await supersedeColleagueChains(deps.cancelAgentTurns, head.userId, sessionId)
  const { userMessage, assistantMessage } = await insertInternalTurn({
    agent: agentParticipant(recipients[0]!.agentId),
    repo,
    streamRegistry,
    now,
    userId: head.userId,
    sessionId,
    content,
    internal: head.internal,
    ...(origin ? { origin } : {}),
    ...(command?.origin ? { commandOrigin: command.origin } : {}),
    ...(routedTo ? { to: routedTo } : {}),
    ...(bindings.length > 0 ? { bindings } : {}),
    ...(plugins.length > 0 ? { plugins } : {}),
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
  // Convert the strategy's recipients into addressed tickets; the event loop consumes them one
  // at a time through the same path as acknowledge and runtime producers.
  try {
    await enqueueTurnTickets(deps.enqueueRun, {
      userId: head.userId,
      session,
      triggerMessageIds: [userMessage.id],
      firstSlotId: assistantMessage.id,
      recipients,
      completion,
      scope: {
        // A remembered task identity can narrow this run, but the strategy owns its concrete
        // participant address. Authority is always re-derived.
        ...mergeIdentity(state.sessionRunIdentity.get(sessionId), {
          ...(extraDisabledTools ? { extraDisabledTools } : {}),
          ...command?.identity,
        }),
        executionContext:
          head.executionContext ?? sessionExecutionContext(session, head.toolSurface, origin),
        conversationId: userMessage.id,
      },
    })
    // Checkpoint delivery only after every execution ticket is durable. Retrying an interrupted
    // fan-out uses the same assistant ids and cannot duplicate a ticket.
    if (!(await leases.ack(head.userId, sessionId, bandIds)))
      throw new Error('Delivery lost its durable lease')
    retire()
    outcome = { status: 'continued' }
  } catch (error) {
    if (claimed.stillQueued()) throw error
    onError(error)
    outcome = {
      status: 'failed',
      kind: 'fatal',
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
      rateLimited: false,
    }
  }
  if (outcome.status !== 'continued') completion.settle(outcome)
  continuations.settleCompletion(bandIds, outcome)
  return 'next'
}
