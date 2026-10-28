import type { MessageBinding } from '@localixai/api/client'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { carriesAuthoredContent } from './authoredMessage'
import { sendFailure } from './sendFailure'
import { useChatStore } from './store'

export interface SendChatMessageOptions {
  bindings?: MessageBinding[]
  /** Hide the user turn in the transcript (the model still sees it) — machine-composed prompts
   *  the user triggered but did not type (e.g. a contributed analysis action). */
  isInternal?: boolean
}

interface SessionSendFlight {
  pending: number
  /** Whether the session was already running before this group painted its optimistic lead. */
  baseRunning: boolean
  /** At least one sibling send reached the backend successfully. */
  accepted: boolean
}

// A session can have several WebSocket requests in flight at once. They share one optimistic
// `isRunning` lead, so a failed sibling may clear it only when the whole group failed and there
// was no run before the group began.
/**
 * How long an idle-looking send waits for the server's answer before its line is shown anyway.
 * A local server answers within a frame or two, so the line appears with the turn; a slow
 * connection must not make Enter feel dead.
 */
export const REVEAL_IDLE_SEND_MS = 120

const sendFlights = new Map<string, SessionSendFlight>()

function beginSendFlight(sessionId: string, baseRunning: boolean): SessionSendFlight {
  let flight = sendFlights.get(sessionId)
  if (!flight) {
    flight = { pending: 0, baseRunning, accepted: false }
    sendFlights.set(sessionId, flight)
  }
  flight.pending += 1
  return flight
}

/** Settle one request. Returns true only when this group solely owned a failed running lead. */
function settleSendFlight(
  sessionId: string,
  flight: SessionSendFlight,
  accepted: boolean,
): boolean {
  // A stale settle must never mutate a newer group for the same session.
  if (sendFlights.get(sessionId) !== flight) return false
  if (accepted) flight.accepted = true
  flight.pending -= 1
  if (flight.pending > 0) return false
  sendFlights.delete(sessionId)
  return !flight.baseRunning && !flight.accepted
}

/**
 * THE send path — every entry point (composer via agent-runtime, mini-app-panel
 * `sendPrompt`) routes through this one helper so
 * each of them gets the same instant paint + failure cleanup. Not a hook: it
 * operates on `useChatStore.getState()`, so bridges can call it directly.
 *
 * Paints the transcript BEFORE the round-trip — your line and the assistant's
 * skeleton appear on the same frame as the send. The server's message.created
 * echoes replace both in place (see applyStreamEvent).
 *
 * On failure it SAYS the send failed: the placeholders are rolled back (the
 * message is not in the transcript, so it must not look like it is), and since
 * the composer already cleared on Enter a silent drop would lose the user's
 * text with no explanation. Fire-and-forget callers `void` this promise, so the
 * toast here is the only place the failure can still be spoken. Rethrows anyway
 * — callers that DO await (e.g. to restore the composer draft) must see it.
 */
export async function sendChatMessage(
  sessionId: string,
  prompt: string,
  opts: SendChatMessageOptions = {},
): Promise<void> {
  if (!sessionId || !carriesAuthoredContent(prompt, opts.bindings)) return
  // No isGenerating guard: the BACKEND owns the queue. Sending while a run is
  // active queues the message; flipping the optimistic flag is a no-op then.
  const state = useChatStore.getState()
  const session =
    state.sessions.find((candidate) => candidate.id === sessionId) ??
    state.allSessions.find((candidate) => candidate.id === sessionId)
  const flight = beginSendFlight(sessionId, Boolean(session?.isRunning))
  const looksIdle = !session?.isRunning && !session?.queuedMessages?.length
  const optimisticIds = state._appendOptimisticSend(
    sessionId,
    prompt,
    opts.bindings,
    opts.isInternal,
    // Only the server knows whether this line starts a turn or waits in its queue, and a row
    // painted for one and withdrawn for the other flashes. An idle-looking send holds its row
    // for the answer; it shows at once when the answer is a started turn.
    looksIdle,
  )
  const reveal = looksIdle
    ? setTimeout(
        () => useChatStore.getState()._releaseQueueHold(sessionId, optimisticIds.userId),
        REVEAL_IDLE_SEND_MS,
      )
    : undefined
  state._setSessionRunning(sessionId, true)
  let accepted = false
  try {
    const result = await backendClient.sendMessage(
      sessionId,
      prompt,
      opts.bindings,
      opts.isInternal,
      optimisticIds.userId,
      session ? (session.projectId ?? null) : undefined,
    )
    accepted = true
    clearTimeout(reveal)
    // A stop/reconnect race can make the local session look idle even though the
    // backend still owns a run and queued this turn. Keep the optimistic user row,
    // but remove this send's assistant skeleton: the queued turn has not started.
    if (result.queued) {
      useChatStore.getState()._dropOptimistic(sessionId, { assistantId: optimisticIds.assistantId })
    } else {
      useChatStore.getState()._releaseQueueHold(sessionId, optimisticIds.userId)
    }
    // The line answered the open `ask` card instead of starting a turn: the card's answer is
    // the transcript's record of it, so neither placeholder stays.
    if (result.answeredInteraction)
      useChatStore.getState()._dropOptimistic(sessionId, optimisticIds)
  } catch (err) {
    clearTimeout(reveal)
    const store = useChatStore.getState()
    store._dropOptimistic(sessionId, optimisticIds)
    const failure = sendFailure(err)
    toast.error(failure.message, { description: failure.detail })
    throw err
  } finally {
    if (settleSendFlight(sessionId, flight, accepted)) {
      useChatStore.getState()._setSessionRunning(sessionId, false)
    }
  }
}
