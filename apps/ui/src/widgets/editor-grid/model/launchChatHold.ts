/**
 * At launch the restored layout decides which tabs are open — nothing else.
 *
 * The launch always selects a session (the remembered one, or the default project's draft),
 * and selecting a session seeds its chat tab. For the launch selection that would override the
 * layout the person left: a workspace closed with no chat tab, or a first run, would open
 * straight into a chat. So the first selection in a window never opens a tab of its own; a
 * chat tab the layout restored is shown as usual, and the session stays selected (warm) behind
 * the empty group. Every later selection opens its tab normally.
 *
 * A `?prompt=` deep link cancels the hold: the prompt is addressed to that chat's composer.
 */
let pending = true

/** Called by a launch that must show its chat (a prompt deep link). */
export function cancelLaunchChatHold(): void {
  pending = false
}

/** True exactly once per window: for the launch's own session selection. */
export function takeLaunchChatHold(): boolean {
  const hold = pending
  pending = false
  return hold
}

/** Tests only: re-arm the once-per-window hold. */
export function resetLaunchChatHoldForTest(): void {
  pending = true
}
