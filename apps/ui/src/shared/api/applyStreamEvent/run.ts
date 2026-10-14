/**
 * A run's rising and falling edge, and the activity phase shown while it is up. The falling
 * edge is the one place that settles what a run left behind: its placeholders, its requests.
 */
import { phaseCopy } from '../phaseCopy'
import { retainHitlInteractions } from './hitl'
import { materializeStreamedTail } from './message-delta'
import type { UiSession } from '../contracts'
import type { StreamEventOf, StreamReducers } from './types'

// A plain signature rather than `StreamReducer<'run.completed' | 'run.failed'>`: TypeScript
// cannot measure the alias's variance through `Extract`, and refuses the wider handler for
// either opcode even though accepting both is exactly what makes it fit each.
function settleRun(
  session: UiSession,
  event: StreamEventOf<'run.completed' | 'run.failed'>,
): UiSession {
  if (event.sessionId !== session.id) return session
  // Clear only requests created by THIS run. Descendant requests are routed onto
  // the root session too and remain answerable after the root's own run ends.
  // Legacy requests without source metadata retain the fail-closed behavior.
  const survivingInteractions = retainHitlInteractions(
    session,
    (interaction) =>
      interaction.sourceSessionId !== undefined && interaction.sourceSessionId !== event.sessionId,
  )
  // Any ASSISTANT placeholder the echo never replaced (a run that died before
  // emitting its rows) is dropped here rather than left as a frozen skeleton.
  // A USER placeholder is dropped only when nothing is queued: a busy-send's
  // line has no echo until the wake drains — the enqueue publish lands before
  // this event, the drain's emptying publish after it, so a non-empty queue
  // means the row's echo is still coming and sweeping it would make the
  // user's message vanish and reappear seconds later.
  const queueEmpty = (session.queuedMessages ?? []).length === 0
  const sweep = (m: (typeof session.messages)[number]) =>
    Boolean(m.optimistic) && (m.role === 'assistant' || queueEmpty)
  const settled = session.messages.some(sweep)
    ? session.messages.filter((m) => !sweep(m))
    : materializeStreamedTail(session.messages)
  return {
    ...session,
    messages: settled,
    isRunning: false,
    activeAgentId: null,
    pendingInteraction: survivingInteractions[0] ?? null,
    pendingInteractionQueue: survivingInteractions.slice(1),
    activePhase: null,
    streamingMessageId: null,
  }
}

export const runReducers: StreamReducers<
  'run.started' | 'run.completed' | 'run.failed' | 'agent.phase'
> = {
  'run.started': (session, event) => {
    if (event.sessionId !== session.id) return session
    // Reset any stale activity phase from a prior run (e.g. a background
    // title-gen that resolved after the last run.completed cleared it). Adopt
    // THIS run's assistant slot as the stream target — the event carries its
    // id, and the server emits it after the message.created echoes, so nulling
    // here would erase the target the assistant echo just set and blank the
    // skeleton for the entire prefill. The previous run's target is dropped
    // all the same: it is overwritten, never carried.
    return {
      ...session,
      isRunning: true,
      activeAgentId: event.agentId ?? null,
      activePhase: null,
      streamingMessageId: event.messageId,
    }
  },
  'run.completed': settleRun,
  'run.failed': settleRun,
  'agent.phase': (session, event) => {
    if (event.sessionId !== session.id) return session
    if (event.active) {
      return {
        ...session,
        activePhase: { id: event.phase, label: phaseCopy(event.phase, event.label) },
      }
    }
    // A leave only clears if it matches the phase currently shown — a stale
    // "leave" must not wipe a newer phase that started in between.
    if (session.activePhase?.id !== event.phase) return session
    return { ...session, activePhase: null }
  },
}
