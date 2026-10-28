/** How many provider/tool-loop turns one agent run may consume. */

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

/** A short scale for the composer's click-to-advance turn-budget control. */
export const MAX_TURNS_STEPS = [1, 5, 20, 100, MAX_MAX_TURNS] as const
