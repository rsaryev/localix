/**
 * Wait for lifecycle state across ONE, ANY, or ALL of a session's links.
 *
 * This is the primitive the whole live half exists to provide: a wait blocks on a state change so
 * a caller does not poll a screen. Every re-screen is a
 * model turn spent on a question a subscription can answer for free.
 *
 * THE DIVISION OF LABOUR with this plugin's own delegate commands (plugin.json). Nothing wakes the
 * session on a delegation's behalf — a delegate is never asked to report back — so a SINGLE
 * delegation is either waited on here or picked up on the caller's next turn through `roster`.
 * SEVERAL delegations are what the `mode` argument exists for: it expresses "when the first of
 * these three needs a decision" (`any`) and "when all three have finished" (`all`), the two real
 * orchestration questions, and neither is answerable by checking one key at a time.
 *
 * Semantics:
 *   - the default target set is {idle, done, blocked} — the settled states;
 *   - a wait whose target ALREADY holds returns immediately rather than hanging for a transition;
 *   - `unknown` is never implied, only matched when asked for explicitly, because "it does not
 *     prove successful completion";
 *   - a timeout is a normal, reported outcome, not an error.
 */

import type { AgentState } from '../../shared/state'
import { quietMinutes } from '../../shared/contracts'
import type { LiveEntry, LiveStore } from './store'

export const DEFAULT_WAIT_STATES: readonly AgentState[] = ['idle', 'done', 'blocked']

/** Bounded so a wait can never outlive the process or wedge a tool call forever. */
export const MAX_WAIT_MS = 30 * 60 * 1000
export const MIN_WAIT_MS = 1_000

export type WaitMode = 'one' | 'any' | 'all'

export interface WaitRequest {
  readonly keys: readonly string[]
  readonly mode: WaitMode
  readonly until: readonly AgentState[]
  readonly timeoutMs: number
}

export interface WaitOutcome {
  readonly satisfied: boolean
  readonly timedOut: boolean
  readonly waitedMs: number
  /** Per-key final state, so the caller always learns where every link ended up. */
  readonly states: Readonly<Record<string, AgentState | 'not-live'>>
  /** Keys that satisfied the target set. */
  readonly matched: readonly string[]
  /**
   * Matched keys whose state came from the manifest's IDLE FALLBACK rather than a matched rule.
   *
   * The distinction is load-bearing and was being thrown away. When no rule matches a screen the
   * evaluator degrades to `idle` for a known agent, and `idle` is in the
   * default target set, so such a key settles a wait instantly. For Claude Code that is every
   * non-blocked screen: its `working` state is read from the terminal's OSC title, and the
   * host's screen snapshot carries text, cursor and size but no title, so there is no positive
   * working signal to match. A wait then reports a busy delegation as settled.
   *
   * Reporting it is the honest half of the fix. Refusing to settle would be worse: a true idle at
   * its prompt is equally unmatched, so the alternative is every Claude wait timing out. The
   * launched path is unaffected — a delegation started by this plugin's commands reports its own
   * lifecycle and screen rules are not consulted at all.
   */
  readonly degraded: readonly string[]
  readonly summary: string
}

function stateOf(live: LiveStore, key: string): AgentState | 'not-live' {
  const entry = live.byKey(key)
  return entry ? entry.state : 'not-live'
}

/**
 * What one pass over the watched keys found.
 *
 * Named rather than inlined because it was inlined and drifted: `still` was added to the returned
 * literal and to the caller's destructuring, and the annotation kept the four fields it had. The
 * plugin's UI project does not compile the backend, so nothing said so — see README, "verifying".
 */
interface Evaluation {
  done: boolean
  matched: string[]
  degraded: string[]
  states: Record<string, AgentState | 'not-live'>
  /** Live keys whose screen has stopped moving, and for how long — the timeout's "why". */
  still: string[]
}

function evaluate(live: LiveStore, request: WaitRequest): Evaluation {
  const states: Record<string, AgentState | 'not-live'> = {}
  const matched: string[] = []
  const degraded: string[] = []
  /**
   * Live keys whose screen has stopped moving, and for how long.
   *
   * A timeout used to report only the states it was still waiting on, which says what did not happen
   * and nothing about why. A still screen is the difference between an agent that is thinking and one
   * that is waiting on something nobody is going to give it — and for Claude Code it is the only
   * evidence available, since its manifest yields no positive `working` state.
   */
  const still: string[] = []
  for (const key of request.keys) {
    const state = stateOf(live, key)
    states[key] = state
    const quiet = quietMinutes(live.byKey(key)?.lastChangeAt, Date.now())
    if (state !== 'not-live' && quiet !== undefined) still.push(`${key} for ${quiet}m`)
    // A key with no live delegation can never transition, so counting it as unmatched would make
    // an `all` wait hang until timeout. It is treated as already settled instead, and the caller
    // sees `not-live` in `states` rather than being told it reached a state it never had.
    if (state === 'not-live' || request.until.includes(state)) {
      matched.push(key)
      // Settled on a state no rule confirmed — see `WaitOutcome.degraded`.
      if (state !== 'not-live' && live.byKey(key)?.explain.fallbackReason) degraded.push(key)
    }
  }
  const done = request.mode === 'all' ? matched.length === request.keys.length : matched.length > 0
  return { done, matched, degraded, states, still }
}

/**
 * Waits currently in flight, so a UI can show what an orchestrator is blocked on.
 *
 * A `wait` is the one thing this plugin does that is INVISIBLE by construction: the model calls it,
 * its turn stops, and nothing on screen says which delegations are being watched or what for. That
 * is fine for the model and bad for the person next to it, who sees three terminals and no reason
 * why nobody is acting on them.
 *
 * Process-local and deliberately unbounded by time: an entry lives exactly as long as its promise,
 * and `waitForStates` removes it in the same `settle` that resolves. Nothing here can outlive a
 * wait, so there is no cleanup to schedule and no staleness to reason about.
 */
export interface ActiveWait {
  readonly id: number
  readonly keys: readonly string[]
  readonly mode: WaitMode
  readonly until: readonly AgentState[]
  readonly startedAt: number
  readonly deadlineAt: number
}

const active = new Map<number, ActiveWait>()
let nextWaitId = 0

export function activeWaits(): readonly ActiveWait[] {
  return [...active.values()]
}

/** Keys any in-flight wait is watching — what the roster marks. */
export function waitedKeys(): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const wait of active.values()) for (const key of wait.keys) keys.add(key)
  return keys
}

export async function waitForStates(
  live: LiveStore,
  request: WaitRequest,
  signal?: AbortSignal,
): Promise<WaitOutcome> {
  const startedAt = Date.now()
  const timeoutMs = Math.min(Math.max(request.timeoutMs, MIN_WAIT_MS), MAX_WAIT_MS)

  const finish = (timedOut: boolean): WaitOutcome => {
    const { done, matched, degraded, states, still } = evaluate(live, request)
    const waitedMs = Date.now() - startedAt
    return {
      satisfied: done,
      timedOut,
      waitedMs,
      states,
      matched,
      degraded,
      summary: describe(request, done, timedOut, matched, states, waitedMs, degraded, still),
    }
  }

  // Return immediately when the condition already holds: a wait observes the current agent and
  // returns at once if its status already matches.
  // Returns before registering: a wait whose condition already holds never blocks anyone, so
  // showing it as in-flight would be a marker that appears and vanishes in the same frame.
  if (evaluate(live, request).done) return finish(false)

  const id = (nextWaitId += 1)
  active.set(id, {
    id,
    keys: request.keys,
    mode: request.mode,
    until: request.until,
    startedAt,
    deadlineAt: startedAt + timeoutMs,
  })

  return new Promise<WaitOutcome>((resolve) => {
    let settled = false
    const settle = (timedOut: boolean) => {
      if (settled) return
      settled = true
      active.delete(id)
      clearTimeout(timer)
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
      resolve(finish(timedOut))
    }
    const onAbort = () => settle(false)
    const timer = setTimeout(() => settle(true), timeoutMs)
    const unsubscribe = live.onChange((_entry: LiveEntry) => {
      if (evaluate(live, request).done) settle(false)
    })
    // An `abort` that fired before this line never fires again, so an already-aborted signal
    // (a tool call stopped while the wait was still being set up) sat out the full timeout —
    // up to MAX_WAIT_MS — instead of returning.
    if (signal?.aborted) settle(false)
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function describe(
  request: WaitRequest,
  done: boolean,
  timedOut: boolean,
  matched: readonly string[],
  states: Readonly<Record<string, AgentState | 'not-live'>>,
  waitedMs: number,
  degraded: readonly string[],
  still: readonly string[],
): string {
  const target = request.until.join(' or ')
  const seconds = Math.round(waitedMs / 100) / 10
  const detail = Object.entries(states)
    .map(([key, state]) => `${key}=${state}`)
    .join(', ')
  // Said in the summary, not only in a field: this is the sentence that stops a caller from acting
  // on "it finished" when nothing observed it finishing. See `WaitOutcome.degraded`.
  const caveat =
    degraded.length > 0
      ? ` NOTE: ${degraded.join(', ')} settled on a state no rule confirmed — the manifest degraded to idle because nothing on the screen matched, so the agent may still be working. Take a reading with { action: "explain" } before relying on this.`
      : ''
  if (done && !timedOut) {
    if (request.mode === 'all')
      return `All ${request.keys.length} session(s) reached ${target} after ${seconds}s. ${detail}${caveat}`
    return `${matched.length} of ${request.keys.length} session(s) reached ${target} after ${seconds}s: ${matched.join(', ')}. ${detail}${caveat}`
  }
  // A timeout that says only which states it was waiting on reports what did not happen. This says
  // what IS happening: a screen that has not moved is the difference between thinking and stuck.
  const stalled =
    still.length > 0
      ? ` Screens unchanged: ${still.join(', ')} — that is how long since the agent last drew anything, so it may be finished, or waiting on something nobody is going to give it.`
      : ''
  return `Timed out after ${seconds}s waiting for ${request.mode === 'all' ? 'all' : 'any'} session to reach ${target}. ${detail}${stalled}`
}
