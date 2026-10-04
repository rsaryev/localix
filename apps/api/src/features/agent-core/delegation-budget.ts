/**
 * Admission limits for task delegation.
 *
 * WHY THIS EXISTS: one session issued `delegate` without any bound and reached 782
 * sub-sessions. The observable failure was not "too many agents" in the abstract — it
 * was 154 provider runs started inside one minute, which saturated the local network
 * stack and the provider together: 469 sockets closed mid-request, 163 TLS handshakes
 * failing with "unknown certificate verification error" (the signature of exhausting
 * handshake capacity, not of a real certificate problem), 139 outright connect failures
 * and 21 rate limits. 741 of the 782 sessions died.
 *
 * Two different dangers, two different bounds:
 *
 *   CONCURRENCY — what actually broke. Held by the LANES (`delegation-lanes.ts`): at most
 *   `DELEGATION_SLOT_CAP` children of one parent run at once, and the rest WAIT. It used to be a
 *   refusal here, which made the model do the scheduling and mostly forget the work.
 *
 *   RUNAWAY — an agent creating children with nobody watching. Held here, per HUMAN TURN: at most
 *   `DELEGATIONS_PER_HUMAN_TURN` new children since the person last wrote. It used to be a
 *   lifetime total per conversation, and a conversation here is endless by design: a lifetime
 *   cap is a wall every long-lived chat hits in ordinary use, while doing nothing sooner about
 *   an agent that spawns twenty-four children in one unattended minute. Counting from the
 *   person's last message bounds exactly the unattended stretch — each message they write is a
 *   person in the loop again — the same shape as the self-caused wake budget
 *   (`wake-queue/self-wake-budget.ts`).
 *
 * WHO may take the work, and how deep a tree may grow, is a third question with its own module
 * (`delegation-hierarchy.ts`).
 *
 * Pure: no I/O, no clock. The caller supplies counts; this decides.
 */

/**
 * How many child sessions of one parent may RUN concurrently; the rest wait in its lanes.
 *
 * A cap in the 2–5 band is where concurrent agent work stops paying: above it the wall-clock
 * gain is eaten by the provider rate limits and local resource contention the concurrency itself
 * causes — which is precisely what the incident measured.
 */
export const DELEGATION_SLOT_CAP = 3

/**
 * How many NEW child sessions an agent may create since the person last wrote in the conversation.
 * Messaging an existing child creates none, so follow-up work is not metered here.
 */
export const DELEGATIONS_PER_HUMAN_TURN = 24

export interface DelegationBudget {
  maxPerHumanTurn: number
}

export const DEFAULT_DELEGATION_BUDGET: DelegationBudget = {
  maxPerHumanTurn: DELEGATIONS_PER_HUMAN_TURN,
}

export interface DelegationFacts {
  /** Child sessions created in this conversation's whole tree since the person's last message. */
  createdSinceHuman: number
}

export type DelegationAdmission =
  | { ok: true }
  /**
   * `reason` is handed to the model verbatim, so it states the limit, the observation
   * that tripped it, AND the action to take instead. A bare "limit exceeded" makes a
   * model retry the identical call, so the message names the knob that produced it.
   */
  | { ok: false; reason: string }

/** A count that arrived from a query or a persisted column may be anything. Clamp it. */
function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Decide whether one more child may be created. Concurrency is not a reason: the lanes wait. */
export function admitDelegation(
  budget: DelegationBudget,
  facts: DelegationFacts,
): DelegationAdmission {
  const created = nonNegative(facts.createdSinceHuman)
  if (created >= budget.maxPerHumanTurn) {
    return {
      ok: false,
      reason:
        `You have started ${created} new sub-agents since the user last wrote, which is the limit of ${budget.maxPerHumanTurn} per user message. ` +
        'Give follow-up work to the sub-agents you already have with `agents` action="message" — that creates none — or do the rest yourself. ' +
        'The limit resets when the user writes again.',
    }
  }

  return { ok: true }
}
