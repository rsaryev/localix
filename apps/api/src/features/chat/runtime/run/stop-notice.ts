/**
 * Turn an abnormal {@link AgentStopReason} into the sentence the user reads when a
 * run was CUT SHORT rather than finished.
 *
 * The loop's no-progress guards used to `break` silently: the run's last persisted
 * item was a tool call, there was no final assistant text, and nothing anywhere said
 * why. The user saw an agent stop mid-task for no reason.
 *
 * This is deliberately NOT model-voiced. The finalizer refuses to fabricate filler in
 * the model's voice ("Completed 5 tool calls."), and that rule holds here: these
 * sentences state, as the system, what the system did — it stopped the run, and on
 * what evidence. Pure; no deps.
 */
import type { AgentStopReason } from '@localixai/agent/agents'

/**
 * `null` for the endings that need no explanation:
 * - `completed` / `tool_terminate` — ordinary stops.
 * - `aborted` — the user pressed Stop; they do not need to be told.
 * - `stream_error` — an `error` event already surfaced the failure.
 *
 * `max_turns` is the only abnormal ending the loop can produce — the old home-grown
 * predecessor's guard reasons (repeated/oscillating calls, content loop, exploration
 * stall, …) were deleted with that loop and their notices with them.
 */
export function stopNotice(reason: AgentStopReason | undefined): string | null {
  switch (reason) {
    // ONE CLAUSE, because it renders as a SYSTEM LINE and not as the model talking
    // (`finalize.ts` writes it as a `turn_limit` notice, which carries its own recovery
    // control). The long version told the reader three things — what stopped it, that the work
    // is unfinished, and what gesture to perform — of which the transcript already showed the
    // second and the notice now offers the third as a button. What is left is the fact.
    case 'max_turns':
      return 'Turn limit reached.'
    case 'completed':
    case 'tool_terminate':
    case 'aborted':
    case 'stream_error':
    case undefined:
      return null
  }
}

/** Whether this ending means work may be left undone (drives the notice + telemetry). */
export function isAbnormalStop(reason: AgentStopReason | undefined): boolean {
  return stopNotice(reason) !== null
}

/**
 * Endings that mean THE MODEL IS STUCK, as opposed to merely unlucky.
 *
 * Every auto-continuation starts a FRESH agent loop with a FRESH turn budget, so
 * resuming after `max_turns` hands a looping model a clean 1000-turn slate and it
 * resumes the very loop the budget just stopped — the "agent that never stops"
 * behaviour, manufactured by the machinery meant to prevent it. Auto-resume is
 * refused here; the user can always continue by sending a message.
 */
export function isLoopingStop(reason: AgentStopReason | undefined): boolean {
  return reason === 'max_turns'
}
