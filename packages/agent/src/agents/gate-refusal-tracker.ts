/**
 * The breaker for a run that keeps attempting what policy will never allow.
 *
 * A permission gate's refusal is invisible to every other guard in the system, and not by
 * oversight: the agent loop turns a blocked call into an immediate error result WITHOUT
 * running the tool, so no tool wrapper sees it, and without running the after-tool hook, so
 * that sees it either. The failure guard, the repeat-call reminder and the mistake breaker
 * all sit on paths a refused call never reaches. Left alone, an unattended run can be told
 * "this is not permitted, do NOT retry" a hundred times and pay for every one of them.
 *
 * Only AUTOMATED refusals count — a rule deny, a mode confinement, or an `ask` on a run
 * with no human reachable. A person declining a call is deliberately NOT counted: the human
 * is right there, steering, and can stop the run themselves; breaking their run because they
 * said no several times would take away the tool they were using. It does not RESET the
 * chain either, since a decline is no evidence the model found a way forward.
 *
 * Two rules, because the failure has two shapes:
 *  - `consecutiveMax` catches the model hammering the wall: refusals back to back, with
 *    nothing getting through in between. Any allowed call clears it — one call through is
 *    progress, and progress is what this is measuring the absence of.
 *  - `windowMax` catches the model working around the wall: a refusal, something harmless,
 *    another refusal. The consecutive count never builds, so a window over recent decisions
 *    is what notices.
 *
 * The verdict LATCHES. Whatever the run does after tripping, it has already established
 * that it cannot get where it is trying to go.
 */

export interface GateRefusalPolicy {
  /** Automated refusals in a row before the run should stop. */
  consecutiveMax?: number
  /** How many recent gate decisions the window covers. */
  windowSize?: number
  /** Automated refusals within the window before the run should stop. */
  windowMax?: number
}

export const DEFAULT_GATE_REFUSAL_POLICY = {
  consecutiveMax: 3,
  windowSize: 50,
  windowMax: 10,
} as const satisfies Required<GateRefusalPolicy>

/** Why the breaker tripped, in the words the model and the transcript both get. */
export interface GateRefusalTrip {
  reason: string
  /** Automated refusals seen when it tripped. */
  refusals: number
}

export interface GateRefusalTracker {
  /** An automated refusal. Returns the trip when this one crossed a threshold. */
  recordAutomaticRefusal(): GateRefusalTrip | undefined
  /** A call the gate let through — the only thing that clears the consecutive chain. */
  recordAllowed(): void
  /** A person declined: neither counted nor cleared, for the reasons above. */
  recordHumanDecline(): void
  /** Latched once a threshold was crossed. */
  tripped(): GateRefusalTrip | undefined
}

export function createGateRefusalTracker(policy: GateRefusalPolicy = {}): GateRefusalTracker {
  const consecutiveMax = policy.consecutiveMax ?? DEFAULT_GATE_REFUSAL_POLICY.consecutiveMax
  const windowSize = policy.windowSize ?? DEFAULT_GATE_REFUSAL_POLICY.windowSize
  const windowMax = policy.windowMax ?? DEFAULT_GATE_REFUSAL_POLICY.windowMax

  let consecutive = 0
  let total = 0
  let trip: GateRefusalTrip | undefined
  // Only the refusals matter, so the window is kept as the decision indices they landed on
  // rather than the decisions themselves — the same answer, bounded by windowMax entries.
  let decisions = 0
  const refusedAt: number[] = []

  return {
    recordAutomaticRefusal() {
      decisions += 1
      consecutive += 1
      total += 1
      refusedAt.push(decisions)
      while (refusedAt.length > 0 && refusedAt[0]! <= decisions - windowSize) refusedAt.shift()
      if (trip) return trip
      if (consecutive >= consecutiveMax) {
        trip = {
          refusals: total,
          reason:
            `${consecutive} tool calls in a row were refused by policy with nothing allowed in between. ` +
            'This run cannot reach what it is attempting; it is ending instead of retrying.',
        }
        return trip
      }
      if (refusedAt.length >= windowMax) {
        trip = {
          refusals: total,
          reason:
            `${refusedAt.length} of the last ${windowSize} tool calls were refused by policy. ` +
            'This run keeps attempting what is not permitted here; it is ending instead of continuing.',
        }
        return trip
      }
      return undefined
    },
    recordAllowed() {
      decisions += 1
      consecutive = 0
    },
    recordHumanDecline() {
      // Not a decision the window should judge the model by: a person answered.
    },
    tripped() {
      return trip
    },
  }
}
