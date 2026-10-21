/**
 * Pure decision for ToolLine's `autoOpen` follow-mode: cards that expand while
 * their tool runs (command output streaming) must SETTLE COLLAPSED when the run
 * finishes — like every other tool card — instead of staying open forever
 * (useState(defaultOpen) only reads the initial value). Edge-triggered: only a
 * CHANGE of the auto signal moves the card, and a user who toggled manually has
 * expressed intent, so the signal never overrides them again.
 *
 * @returns the new open state, or null to leave the current state alone.
 */
export function autoOpenTransition(
  prev: boolean | undefined,
  next: boolean | undefined,
  userToggled: boolean,
): boolean | null {
  if (next === undefined || prev === next) return null // no signal / no edge
  if (userToggled) return null // user intent wins over the auto signal
  return next
}
