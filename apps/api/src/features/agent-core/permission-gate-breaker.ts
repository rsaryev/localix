import type { GateRefusalTracker } from '@localixai/agent/agents'

import type { PermissionGateFn } from './permission-gate'
import { breakerTripped } from './permission-refusal-person'

/**
 * Counting the gate's refusals, kept separate from deciding them.
 *
 * The gate answers one call at a time and has no memory; this wrapper is the memory. It
 * exists because a blocked call is invisible everywhere else: the agent loop turns the
 * refusal into a tool result WITHOUT running the tool, so no tool wrapper observes it, and
 * without running the after-tool hook, so nothing downstream does either.
 *
 * `automatic` is the DEFAULT for a refusal that does not say what it is, and that default is
 * structural rather than convenient: a human is consulted in exactly one place in the gate —
 * the `requestConfirm` call — and that place tags its refusal `human`. Anything else refused
 * without a human being asked, which is what automatic means. A block site added later is
 * therefore counted by construction instead of quietly exempt.
 *
 * When the breaker trips, the reason is APPENDED to the message the model already gets.
 * Ending the run at the next turn boundary and saying nothing would leave a transcript whose
 * last word is a routine refusal, and no explanation of why nothing followed it.
 */
export function withRefusalBreaker(
  decide: PermissionGateFn,
  tracker: GateRefusalTracker,
): PermissionGateFn {
  return async (ctx, signal) => {
    const verdict = await decide(ctx, signal)
    if (!verdict?.block) {
      // Includes `undefined` — the gate's plain allow. A call getting through is the only
      // evidence that the run is not simply hammering a wall.
      tracker.recordAllowed()
      return verdict
    }
    if (verdict.refusal === 'human') {
      tracker.recordHumanDecline()
      return verdict
    }
    const trip = tracker.recordAutomaticRefusal()
    if (!trip) return verdict
    const message = verdict.blockedMessage
    return {
      ...verdict,
      blockedMessage: message ? `${message}\n\n${trip.reason}` : trip.reason,
      // The model's trip reason talks about "this run" attempting things; the person reads
      // that the run stopped, and how many refusals it took.
      personMessage: breakerTripped(trip.refusals),
    }
  }
}
