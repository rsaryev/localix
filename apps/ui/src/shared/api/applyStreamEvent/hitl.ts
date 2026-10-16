/**
 * Human-in-the-loop requests: the one card on screen and the queue behind it. Whoever raised the
 * head is blocked on its answer, so a new request never displaces it — it waits its turn.
 */
import type { PendingHitlInteraction, UiPendingHitlInteraction, UiSession } from '../contracts'
import type { StreamReducers } from './types'

/**
 * The HITL kinds this client can draw a card for. A kind absent here is dropped rather than
 * queued: an interaction nobody can render would block the queue behind it forever.
 */
const RENDERABLE_HITL_KINDS = new Set(['ask', 'confirm', 'request_secret', 'config_change'])

export const hitlReducers: StreamReducers<'hitl.requested' | 'hitl.resolved'> = {
  'hitl.requested': (session, event) => {
    if (event.sessionId !== session.id) return session
    const pendingInteraction: PendingHitlInteraction = event.request
    // ONE shape for four kinds. These were four near-identical branches differing only in a
    // string and a payload cast, and every envelope field added since had to be written
    // four times — `expiresAt` was dropped by all four until this collapsed them.
    const incoming: UiPendingHitlInteraction | null = RENDERABLE_HITL_KINDS.has(
      pendingInteraction.kind,
    )
      ? ({
          kind: pendingInteraction.kind,
          sourceSessionId: pendingInteraction.sourceSessionId,
          request: {
            id: pendingInteraction.requestId,
            kind: pendingInteraction.kind,
            title: pendingInteraction.title,
            payload: pendingInteraction.payload,
            ...(pendingInteraction.expiresAt ? { expiresAt: pendingInteraction.expiresAt } : {}),
          },
          // The kind is the discriminant and it is only known at runtime; the set above is
          // what makes this cast true, and an unknown kind is dropped rather than rendered.
        } as UiPendingHitlInteraction)
      : null
    if (!incoming) return session

    // A re-published request (reconnect/reconcile replays the live one) must
    // refresh in place, never enqueue a second copy of itself.
    const id = incoming.request.id
    if (session.pendingInteraction?.request.id === id) {
      return { ...session, pendingInteraction: incoming }
    }
    const queue = session.pendingInteractionQueue ?? []
    if (queue.some((q) => q.request.id === id)) {
      return {
        ...session,
        pendingInteractionQueue: queue.map((q) => (q.request.id === id ? incoming : q)),
      }
    }
    // The head STAYS put: whoever is awaiting it is still blocked on an answer,
    // so replacing it would strand them. New arrivals wait their turn.
    if (session.pendingInteraction) {
      return { ...session, pendingInteractionQueue: [...queue, incoming] }
    }
    return { ...session, pendingInteraction: incoming }
  },

  'hitl.resolved': (session, event) => {
    if (event.sessionId !== session.id) return session
    // A pending ask/quiz/confirm was answered or dismissed. Drop the overlay
    // immediately rather than waiting for run.completed. Guard on requestId so a
    // late clear for an already-replaced prompt doesn't hide the newer one.
    const queue = session.pendingInteractionQueue ?? []
    if (session.pendingInteraction?.request.id === event.requestId) {
      // Answering the head promotes the next waiter into the overlay.
      const [next, ...rest] = queue
      return { ...session, pendingInteraction: next ?? null, pendingInteractionQueue: rest }
    }
    // A QUEUED request can resolve before it is ever shown — it timed out, or the
    // sub-agent that asked was stopped. Drop it silently; the head is untouched.
    if (queue.some((q) => q.request.id === event.requestId)) {
      return {
        ...session,
        pendingInteractionQueue: queue.filter((q) => q.request.id !== event.requestId),
      }
    }
    return session
  },
}

/** Keep only the requests `keep` accepts, the first of them becoming the head. */
export function retainHitlInteractions(
  session: UiSession,
  keep: (interaction: UiPendingHitlInteraction) => boolean,
): UiPendingHitlInteraction[] {
  return [
    ...(session.pendingInteraction ? [session.pendingInteraction] : []),
    ...(session.pendingInteractionQueue ?? []),
  ].filter(keep)
}

/** Remove routed prompts whose originating child run has terminated. */
export function removeHitlInteractionsFromSource(
  session: UiSession,
  sourceSessionId: string,
): UiSession {
  const total =
    (session.pendingInteraction ? 1 : 0) + (session.pendingInteractionQueue ?? []).length
  const surviving = retainHitlInteractions(
    session,
    (interaction) => interaction.sourceSessionId !== sourceSessionId,
  )
  if (surviving.length === total) return session
  return {
    ...session,
    pendingInteraction: surviving[0] ?? null,
    pendingInteractionQueue: surviving.slice(1),
  }
}
