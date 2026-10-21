/**
 * Keyboard-answering helpers shared by the HITL interaction views.
 *
 * Enter resolves the PRIMARY (affirmative) action of an interaction: Enter
 * confirms / advances, while Escape denies / dismisses. Keeping that keyboard
 * contract consistent lets confirmation and stepped-question views share the
 * same frame-level handling. This module owns only the pure decision of what
 * Enter should do for a multi-question ask/quiz; the frame wires it up.
 */

export interface EnterActionState {
  /** The current question already has a selection (or custom answer). */
  currentAnswered: boolean
  /** Every question is answered — the whole form can be submitted. */
  canSubmit: boolean
  /** The active question is the last one in the sequence. */
  isLast: boolean
}

/**
 * Decide what pressing Enter should do on a stepped ask/quiz form:
 * - `submit` — on the last question once all are answered;
 * - `next` — advance to the next question when the current one is answered;
 * - `null` — nothing actionable yet (Enter is a no-op, never a blind submit).
 */
export function nextEnterAction(state: EnterActionState): 'submit' | 'next' | null {
  if (state.isLast) return state.canSubmit ? 'submit' : null
  return state.currentAnswered ? 'next' : null
}
