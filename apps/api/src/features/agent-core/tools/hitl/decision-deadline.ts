/**
 * ONE deadline for every request that blocks a run on a person, and one way of saying what
 * happened when it passes.
 *
 * Before this there were four answers to the same question. `ask` waited 180 seconds and then
 * ANSWERED ITSELF with the recommended option. `configure` waited five minutes and declined.
 * `vault` set a ten-minute envelope expiry. A tool-approval confirm and an agent-invocation
 * approval waited forever — a run that asked while nobody was at the keyboard stayed blocked
 * until the process restarted. Each of them was defensible alone; together they meant a user
 * could not learn what an unanswered card does, because it depended on which card it was.
 *
 * The rule now: five minutes, everywhere, and silence is a REFUSAL — never a guess at what
 * the user would have said. The auto-answer `ask` used to perform was the worst of them: a
 * run continued as though a person had chosen, and the transcript recorded a decision nobody
 * made.
 *
 * Nothing is mutated on the way out. An expired card writes no rule, stores no secret, starts
 * no agent and changes no setting — the run is told no, and that is all that happens.
 */

import type { ToolErrorPayload } from '@localixai/agent'

/** Five minutes, in the one place the number lives. */
export const HITL_DECISION_MS = 5 * 60_000

const MINUTES = HITL_DECISION_MS / 60_000

/** The envelope deadline the HITL controller enforces (`expiresAt` → `HumanInLoopTimeoutError`). */
export const hitlDecisionDeadline = (): number => Date.now() + HITL_DECISION_MS

/**
 * What the MODEL is told, and why it is not the same sentence as a human "no".
 *
 * A person declining is information: they looked at the call and did not want it, so asking
 * again in another form is usually wrong. A timeout is the absence of information — nobody
 * looked. A model that cannot tell the two apart either treats an empty room as a refusal
 * and gives up on work it was asked to do, or treats a refusal as an accident and asks
 * again. The shared head is deliberately loud and identical everywhere, so the difference is
 * learnable from one occurrence.
 */
export function unansweredRefusal(tail: string): string {
  return (
    `AUTO-DENIED — nobody answered within ${MINUTES} minutes. ` +
    'The system closed this request on the user’s behalf: no one approved it, no one ' +
    `refused it, and nothing was changed. ${tail}`
  )
}

/**
 * What the PERSON reads about the same expiry. The model's sentence above is an instruction
 * ("Do not retry the call") and addresses the reader as "the user"; on a card it read as
 * though somebody else had been asked.
 */
export const UNANSWERED_PERSON_MESSAGE = `No one answered in ${MINUTES} minutes`

/**
 * The error an expired card's tool result carries, so its card shows the person's sentence and
 * renders neutral. Tagged `refusal: 'human'` for the reason the gate tags an expired approval
 * that way: nothing went wrong in the run, a person was not there.
 */
export function unansweredError(modelText: string): ToolErrorPayload {
  return {
    kind: 'timeout',
    message: modelText,
    userMessage: UNANSWERED_PERSON_MESSAGE,
    personMessage: UNANSWERED_PERSON_MESSAGE,
    refusal: 'human',
    retryable: false,
  }
}

/** The tail for a blocked tool call: the run may continue, just not with this. */
export const UNANSWERED_CALL_TAIL =
  'Do not retry the call. Continue with what you already have, or stop and say plainly what you need and why.'

/** Was this rejection the deadline passing, rather than a person dismissing the card? */
export function isHitlTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'HumanInLoopTimeoutError'
}
