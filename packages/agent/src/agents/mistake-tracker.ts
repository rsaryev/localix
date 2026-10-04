/**
 * Cross-reason consecutive-failure circuit breaker.
 *
 * The gap it closes: every existing brake keys on SAMENESS — the failure guard on an
 * identical failing call signature, the repeat-call reminder on identical/ABAB call
 * signatures — so a model failing DIFFERENTLY each time (a provider error, then a
 * malformed tool call, then a tool that executes and fails) never trips any of them
 * and can burn a whole session without a single unit of progress. This counter keys
 * on the OUTCOME instead: any classified mistake increments one consecutive counter
 * regardless of reason, and only a genuine success resets it.
 *
 * Composition contract: this NEVER parses errors itself — callers classify with
 * `classifyAgentError` / the tool result's `error.kind` and hand this module a
 * {@link MistakeReason}. It also never merges with the failure guard: that one is
 * per-identical-signature (and stops earlier, at 4), this one is per-reason-class
 * across different calls (and stops later, at 5), so the identical-call detector
 * always wins when both would apply and this only fires on VARIED failures.
 *
 * Pure and run-scoped: no I/O, no timers — one instance per run, discarded with it.
 */

export type MistakeReason = 'api_error' | 'invalid_tool_call' | 'tool_execution_failed'

export interface MistakeTrackerState {
  /** Failures since the last success, across ALL reasons. */
  consecutive: number
  /** Per-reason share of `consecutive` (for the stop message's breakdown). */
  perReason: Record<MistakeReason, number>
  lastReason?: MistakeReason
  lastDetail?: string
}

export interface MistakeTrackerOptions {
  /**
   * Stop/notify once this many failures accumulate with no success between.
   * Default 5 — deliberately more generous than the failure guard's 4, because
   * varied failures can be genuine (if clumsy) exploration, while an identical
   * repeat is provably stuck.
   */
  maxConsecutive?: number
  /**
   * Decide what hitting the limit means for this run. 'stop' (default) latches a
   * terminal verdict; 'continue-with-notice' injects recovery guidance ONCE and
   * resets the counters so the model gets a fresh budget.
   * Consulted exactly once per limit episode — never re-polled while latched.
   */
  onLimit?: (state: Readonly<MistakeTrackerState>) => 'continue-with-notice' | 'stop'
}

export type MistakeCheck =
  | { action: 'ok' }
  | { action: 'notice'; text: string }
  | { action: 'stop'; message: string }

export interface MistakeTracker {
  /** Count one classified failure. `detail` (first line, e.g. "bash: exit 127") feeds the stop message. */
  record(reason: MistakeReason, detail?: string): void
  /** Any real success means the run is making progress — everything resets. */
  recordSuccess(): void
  /** Consult after each record (and before acting again once stopped — the stop verdict latches). */
  check(): MistakeCheck
  /** Snapshot for telemetry/tests; mutating it changes nothing. */
  state(): Readonly<MistakeTrackerState>
}

const REASON_LABELS: Record<MistakeReason, [singular: string, plural: string]> = {
  api_error: ['api error', 'api errors'],
  invalid_tool_call: ['invalid tool call', 'invalid tool calls'],
  tool_execution_failed: ['execution failure', 'execution failures'],
}

/** "2 api errors, 2 invalid tool calls, 1 execution failure" — nonzero reasons only, fixed order. */
function describeBreakdown(perReason: Record<MistakeReason, number>): string {
  const parts: string[] = []
  for (const reason of Object.keys(REASON_LABELS) as MistakeReason[]) {
    const n = perReason[reason]
    if (n > 0) parts.push(`${n} ${REASON_LABELS[reason][n === 1 ? 0 : 1]}`)
  }
  return parts.join(', ')
}

function emptyPerReason(): Record<MistakeReason, number> {
  return { api_error: 0, invalid_tool_call: 0, tool_execution_failed: 0 }
}

export function createMistakeTracker(options: MistakeTrackerOptions = {}): MistakeTracker {
  // Floor of 2: a limit of 1 would stop on the FIRST failure of a run, turning
  // every ordinary recoverable error into a session brake.
  const maxConsecutive = Math.max(2, options.maxConsecutive ?? 5)
  const onLimit = options.onLimit ?? (() => 'stop' as const)

  let consecutive = 0
  let perReason = emptyPerReason()
  let lastReason: MistakeReason | undefined
  let lastDetail: string | undefined
  // The stop verdict LATCHES: once the limit episode resolved to 'stop', every later
  // check() returns the same message so a caller polling before each action keeps
  // short-circuiting — and `onLimit` is never consulted a second time for the episode.
  let latchedStop: string | undefined

  const snapshot = (): MistakeTrackerState => ({
    consecutive,
    perReason: { ...perReason },
    ...(lastReason !== undefined ? { lastReason } : {}),
    ...(lastDetail !== undefined ? { lastDetail } : {}),
  })

  const reset = () => {
    consecutive = 0
    perReason = emptyPerReason()
    lastReason = undefined
    lastDetail = undefined
  }

  return {
    record(reason, detail) {
      consecutive += 1
      perReason[reason] += 1
      lastReason = reason
      if (detail !== undefined) lastDetail = detail
    },
    recordSuccess() {
      // Deliberately does NOT clear a latched stop: once the episode resolved to
      // 'stop' the run is ending, and a racing success must not un-stop it.
      reset()
    },
    check() {
      if (latchedStop !== undefined) return { action: 'stop', message: latchedStop }
      if (consecutive < maxConsecutive) return { action: 'ok' }
      const state = snapshot()
      const breakdown = describeBreakdown(state.perReason)
      if (onLimit(state) === 'continue-with-notice') {
        // Guidance instead of a brake — and a FULL reset, so the model earns a fresh
        // budget rather than re-tripping the limit on its very next failure.
        reset()
        return {
          action: 'notice',
          text:
            `${state.consecutive} consecutive failures without a single success (${breakdown}). ` +
            `Stop and diagnose the shared root cause before acting again — re-read the failing ` +
            `output, verify paths and arguments, or change the approach entirely. The failure ` +
            `counter was reset; ${maxConsecutive} more failures without a success will stop the run.`,
        }
      }
      latchedStop =
        `${state.consecutive} consecutive failures: ${breakdown}` +
        (state.lastDetail ? `; last: ${state.lastDetail}` : '') +
        '. The run was stopped to avoid burning more turns without progress. ' +
        'Session state was preserved. Send a new prompt to resume.'
      return { action: 'stop', message: latchedStop }
    },
    state: snapshot,
  }
}
