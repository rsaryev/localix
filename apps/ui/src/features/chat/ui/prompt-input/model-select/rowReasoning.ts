import type { ReasoningEffort } from '../../../model/reasoning'

/**
 * WHAT ONE MODEL ROW SAYS ABOUT REASONING — a choice, or an inheritance, never the two mixed.
 *
 * The picker shows a level on every row, and the rows do not all mean the same thing by it. One
 * model has a level because the user set it; the other forty have one because that is what they
 * WOULD run at if picked. Painting both the same way is what made a single change look global:
 * raise the level on the model you are using, and every row without a choice of its own repaints
 * with it, because the carried level is the session's.
 *
 * So the two are returned separately and the control already knows the difference — `value` is a
 * choice, `inherited` renders as "Session" and is not editable state. One rule, one place:
 * spread across two callbacks in the routing hook, the second one only marked inheritance for
 * workload rows and the chat's rows silently claimed every carried level as their own.
 */
export interface RowReasoning {
  /** The level chosen FOR THIS MODEL, or undefined when nothing was ever chosen. */
  value: ReasoningEffort | undefined
  /** What it runs at anyway — shown instead of a choice, and offered as a way back to one. */
  inherited: ReasoningEffort | undefined
}

export interface RowReasoningInput {
  /** Is this the row the conversation (or workload) is currently on. */
  selected: boolean
  /**
   * The level the SELECTED row holds: the participant's seat in a chat, the workload's slot
   * otherwise. Only meaningful when `selected`.
   */
  chosen: ReasoningEffort | undefined
  /** What this provider/model was last set to by hand, if ever. */
  saved: ReasoningEffort | undefined
  /** The level a model with no choice of its own would run at. */
  carried: ReasoningEffort
  /**
   * The session's level, offered on a WORKLOAD row as the way back to "follow the chat". A chat
   * row has no such fallback — its seat is the session — so callers omit it there.
   */
  sessionFallback?: ReasoningEffort | undefined
}

export function rowReasoning({
  selected,
  chosen,
  saved,
  carried,
  sessionFallback,
}: RowReasoningInput): RowReasoning {
  if (selected) {
    // A workload row keeps its way back to the session's level even while it holds a choice —
    // that button is how the override is dropped.
    if (sessionFallback !== undefined) return { value: chosen, inherited: sessionFallback }
    return chosen === undefined
      ? { value: undefined, inherited: carried }
      : { value: chosen, inherited: undefined }
  }
  // Keep the inheritance available alongside a saved preview choice: otherwise the menu
  // removes "Follow the conversation" as soon as a level is chosen and offers no way to clear it.
  return { value: saved, inherited: carried }
}
