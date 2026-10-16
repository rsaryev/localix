/**
 * Sticky-scroll of the running command's prompt line.
 *
 * When a command's output is long enough to scroll its prompt line off the top of
 * the terminal viewport, we pin a one-row header showing that command's typed text
 * (like the editor's sticky scroll pins the enclosing scope). This rides entirely
 * on the OSC 133 semantic-prompt marks already tracked in `TerminalPane` — no new
 * backend, no second xterm instance (a single DOM row is enough here).
 *
 * A command occupies the physical-buffer rows `[promptLine, endLine)`; a still-
 * running command has `endLine === null` (it extends to the live bottom). The
 * viewport's top absolute row is `topLine`. We pin the command whose region
 * strictly contains `topLine` — i.e. its prompt has scrolled above the top but we
 * are still inside its output. Commands are sequential (never nested), so at most
 * one qualifies; if several somehow overlap we keep the innermost (largest
 * `promptLine`). Between commands (idle prompt, blank scrollback) nothing pins.
 */

export interface StickyCommand {
  /** Absolute buffer row of the command's prompt/input line (mark `A`). */
  promptLine: number
  /** Absolute buffer row just past the command's last output row (mark `D`); null while running. */
  endLine: number | null
  /** The command the user typed (prompt stripped), single-lined for the header. */
  text: string
}

/**
 * Pick the command to pin for a given viewport top, or null when none applies.
 * Pure so it can be unit-tested away from xterm.
 */
export function computeStickyCommand(
  topLine: number,
  commands: readonly StickyCommand[],
): StickyCommand | null {
  let best: StickyCommand | null = null
  for (const cmd of commands) {
    // Prompt must be above the top (otherwise it's already visible → nothing to pin)…
    if (cmd.promptLine >= topLine) continue
    // …and we must still be inside this command's region.
    const withinRegion = cmd.endLine === null ? true : topLine < cmd.endLine
    if (!withinRegion) continue
    if (!best || cmd.promptLine > best.promptLine) best = cmd
  }
  if (!best?.text) return null
  return best
}
