/** How many provider/tool-loop turns one agent run may consume, and how long a chain of
 * participants handing the floor to each other may run before the person hears back. */

/**
 * The longest chain of handoffs one message of the person's may start.
 *
 * Handoffs had no bound at all: two participants that each think the other should go next
 * ping-pong until someone intervenes, and every hop is a paid run. The person can always
 * interrupt (their message outranks the chain in the queue), but they should not have to. Twelve
 * hops is a long, real collaboration — a plan, two implementers, a reviewer, a fix round — and
 * short enough that a loop is caught within minutes. The count resets whenever the person
 * speaks, because a new message is a new request.
 */
export const MAX_HANDOFF_CHAIN = 12

/**
 * The cap when the person has not set one.
 *
 * High enough that it never stops a productive run — the loop ends when the model stops calling
 * tools, and the no-progress guards stop a stuck one. It exists so every reader has a number
 * rather than an `undefined` to branch on.
 */
export const DEFAULT_MAX_TURNS = 1000

/**
 * What the control may be set to.
 *
 * The floor is 1 because one turn is a coherent request: answer once and stop. The ceiling is
 * the default, because a cap above "effectively no cap" would be a number that cannot do
 * anything — the setting only ever lowers a budget.
 */
export const MIN_MAX_TURNS = 1
export const MAX_MAX_TURNS = DEFAULT_MAX_TURNS

/** Snap a stored or typed value into the range, so no reader has to repeat the check. */
export function clampMaxTurns(value: number | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return DEFAULT_MAX_TURNS
  return Math.min(MAX_MAX_TURNS, Math.max(MIN_MAX_TURNS, Math.round(value!)))
}

/**
 * The steps the composer's menu offers.
 *
 * Not every integer, and that is the point of listing them: the useful settings are "answer
 * once", "a short exchange", "a real task", and "do not stop it", and a list of 1 to 1000 would
 * bury the setting the person wanted. The scale is coarse where the difference stops mattering,
 * which is everywhere above a few dozen.
 */
export const MAX_TURNS_STEPS = [1, 2, 3, 5, 8, 12, 20, 30, 50, 100, 250, 500, 1000] as const
