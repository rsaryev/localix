/**
 * Mid-run reminder channel (server side).
 *
 * The host has two ways to tell the agent something, and neither can reach an
 * agent that is CURRENTLY working:
 *
 *  - per-run reminders (reminders.ts) are built once, before sampling, from
 *    history — by definition they cannot carry a fact that becomes true later;
 *  - `wake` starts a NEW run, so the wake queue holds it until the current run
 *    ends (see wake-queue's drain).
 *
 * So a fact that lands mid-turn — a background job finishing — stays invisible
 * for the rest of a turn that may run for minutes and dozens of tool calls. The
 * agent's only recourse was to poll `jobs`, which is exactly the sleep-loop the
 * background-jobs reminder tells it not to do.
 *
 * This buffers such facts per session and appends them to the next tool RESULT the
 * loop writes (`withMidRunReminders`) — the one point where extra text is safe (never
 * wedged between a tool_use and its tool_result), and where it is persisted with the
 * result, so the history stays append-only. The cost is the seam's honest limit: the
 * agent must call at least one more tool. A turn that ends without another tool call
 * leaves the entry queued, and it surfaces on the next turn instead — never lost, just
 * later. The buffer itself is process-lifetime and bounded.
 *
 * Ownership: entries are keyed by EXECUTION ADDRESS — session and participant — in a
 * process-wide map. Keyed by session alone, a job one participant started announced its end
 * inside a colleague's run, which then acted on work it never did. A sessionId is globally
 * unique and its owner is fixed, so the key cannot collide across users. It is NOT the
 * pattern the sibling `actionRegistry` uses (owner tagged onto the entry): that one is keyed
 * by toolCallId and reachable from an RPC carrying only that id, so it has to prove
 * ownership at the map. This queue is only ever read by the loop for the address it runs.
 */
import {
  agentLaneKey,
  agentLaneSessionPrefix,
  type ExecutionAddress,
} from '../../agent-core/execution-address'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

/** Max entries buffered per session. Far above any real burst; a backstop, not a policy. */
export const MID_RUN_REMINDER_MAX = 8

/** The RuntimeState map this module owns (kept on RuntimeState, reaped there). */
export interface MidRunReminderState {
  /** Execution-address key → queued reminder bodies (no tags), drained at the loop's tool seam. */
  midRunReminders: Map<string, string[]>
}

/**
 * Queue one reminder body for a session. `body` is plain prose — the tags are
 * added at drain time, so a caller cannot accidentally emit a half-formed
 * envelope. Oldest entries are evicted past the cap: if that many facts pile up
 * inside one turn, the newest are the ones still worth acting on.
 */
export function recordMidRunReminder(
  state: MidRunReminderState,
  address: ExecutionAddress,
  body: string,
  cap: number = MID_RUN_REMINDER_MAX,
): void {
  const trimmed = body.trim()
  if (!trimmed) return
  const key = agentLaneKey(address)
  const queue = state.midRunReminders.get(key) ?? []
  queue.push(trimmed)
  while (queue.length > cap) queue.shift()
  state.midRunReminders.set(key, queue)
}

/**
 * Drain a session's queued reminders into ONE `<system-reminder>` body, or null
 * when nothing is pending. A drain, not a peek — the loop appends the result
 * exactly once and never re-reads it, so the queue is cleared unconditionally.
 *
 * One envelope for the whole batch (not one per entry) keeps two facts arriving
 * in the same turn from reading as two separate interruptions.
 */
export function drainMidRunReminders(
  state: MidRunReminderState,
  address: ExecutionAddress,
): string | null {
  const key = agentLaneKey(address)
  const queue = state.midRunReminders.get(key)
  state.midRunReminders.delete(key)
  if (!queue || queue.length === 0) return null
  return [
    '<system-reminder>',
    ...queue,
    'This reminder is auto-generated; never mention it to the user.',
    '</system-reminder>',
  ].join('\n')
}

/**
 * The body for a background job that finished while the agent was working.
 *
 * Deliberately carries the exit code but NOT the output: a job's output can be
 * megabytes of build log, and this lands unbidden in the middle of an unrelated
 * turn. (The `notify_on_complete` path is the opposite trade — the user asked to
 * be interrupted, so a wake carries the full output as its own turn.)
 *
 * Withholding the output only works if the pointer to it is real, and `jobs`
 * is NOT that pointer: `action="read"` maps a job to its live PTY scrollback via
 * `backgroundJobs`, and the async registry's disposer drops the entry the moment
 * the job ends — so a read on a job this reminder just announced is guaranteed to
 * miss, and it fails with "its final output was returned when it finished", which
 * on THIS branch is precisely the thing that did not happen. An agent told a job
 * failed, sent to a tool that denies the output exists, and forbidden to re-run,
 * has been handed a dead end.
 *
 * `tool_output` is the real handle: `emitBackground` writes the full output to
 * the job's tool item (`details.output` + `resultText`) and persists it on `done`,
 * and that tool serves any earlier call's stored output back by tool_call_id. When
 * the user disables it, the reminder omits the dead call and permits a safe rerun.
 */
export function backgroundJobFinishedReminder(
  command: string,
  exitCode: number | undefined,
  toolCallId: string,
  recoveryToolAvailable = true,
  jobStatus?: string,
): string {
  // A job the caller (or the user) STOPPED is not a failure and not news: say what happened so
  // the model does not spend its reply explaining an "exit -1" it caused.
  const status =
    jobStatus === 'killed'
      ? 'was stopped as requested'
      : exitCode === undefined
        ? 'finished'
        : exitCode === 0
          ? 'finished successfully (exit 0)'
          : `FAILED (exit ${exitCode})`
  const recovery = recoveryToolAvailable
    ? `Its full output is stored: \`tool_output(action="get", tool_call_id="${toolCallId}")\`.`
    : 'Its output is not stored in this run.'
  return `A background job you started ${status} while you were working: \`${command}\`. ${recovery}`
}

type AfterToolCall = NonNullable<AgentRuntimeRunInput['afterToolCall']>

/**
 * Deliver the queued reminders at the seam where a tool result is written — appended to it.
 *
 * A reminder injected as a message of its own after the tool results existed in one request
 * and nowhere in the stored turn, so the next turn rebuilt a history without it: an edit of
 * what the model had already read, which misses the provider's prefix cache and, on models
 * with preserved thinking, drops every later thinking block. Riding the result text, it is
 * persisted with the tool item and replayed in place — the append-only form providers
 * document for this (a text block after the tool_result).
 */
export function withMidRunReminders(
  afterToolCall: AfterToolCall,
  drain: () => string | null,
): AfterToolCall {
  return async (context, signal) => {
    const result = await afterToolCall(context, signal)
    const reminder = drain()
    if (!reminder) return result
    return { ...result, content: `${result?.content ?? context.result.content}\n\n${reminder}` }
  }
}

/** Reap a deleted session's queued reminders. */
export function forgetMidRunReminders(state: MidRunReminderState, sessionId: string): void {
  const prefix = agentLaneSessionPrefix(sessionId)
  for (const key of state.midRunReminders.keys()) {
    if (key.startsWith(prefix)) state.midRunReminders.delete(key)
  }
}
