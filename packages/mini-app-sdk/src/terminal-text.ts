/**
 * Text that came from a terminal or a provider, as ONE inert line a surface can show.
 *
 * React escapes markup, not cursor, OSC and CSI sequences: a label or an output line that reaches
 * any byte-stream surface (a log, a terminal) is INTERPRETED rather than shown, and on screen the
 * sequences are noise. Provider labels and a running command's last output line are the same
 * problem, so they share one rule instead of two regexes that drift.
 */
// oxlint-disable-next-line no-control-regex -- deliberately strips terminal escapes
const ANSI_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)?)/g
// oxlint-disable-next-line no-control-regex -- C0/C1 controls are never presentation text
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/g

/** `value` cut to `maxChars`, escapes removed, controls and runs of whitespace as one space. */
export function inertLine(value: string, maxChars: number): string {
  return value
    .slice(0, maxChars)
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARACTER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
