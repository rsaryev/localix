/**
 * Client half of shell integration: parse the OSC 133 semantic-prompt marks the
 * shell emits (see api `features/terminal/shell-integration.ts`) so the terminal
 * pane can draw a per-command exit-code dot and navigate between prompts.
 *
 * The payload passed here is the text AFTER `133;` — e.g. `"A"`, `"C"`, `"D;1"`.
 */
export type Osc133Event =
  | { type: 'A' } // prompt start
  | { type: 'B' } // prompt end / input start
  | { type: 'C' } // command output start
  | { type: 'D'; exitCode: number | null } // command finished (exit code, or null if unknown)

/** Parse an OSC 133 payload; returns null for anything we don't recognize. */
export function parseOsc133(payload: string): Osc133Event | null {
  const parts = payload.split(';')
  switch (parts[0]) {
    case 'A':
      return { type: 'A' }
    case 'B':
      return { type: 'B' }
    case 'C':
      return { type: 'C' }
    case 'D': {
      const raw = parts[1]
      if (raw === undefined || raw === '') return { type: 'D', exitCode: null }
      const code = Number.parseInt(raw, 10)
      return { type: 'D', exitCode: Number.isFinite(code) ? code : null }
    }
    default:
      return null
  }
}

/**
 * Solid `#RRGGBB` dot color for a command's exit code — xterm decorations only
 * accept hex, so the palette is theme-branched instead of tokenized. Green =
 * success, red = failure, neutral grey = unknown code; the light branch uses
 * the LIGHT_ANSI hues so dots stay legible on the white terminal background.
 */
export function exitDotColor(exitCode: number | null, isLight = false): string {
  if (isLight) {
    if (exitCode === null) return '#6a737d'
    return exitCode === 0 ? '#28a745' : '#d73a49'
  }
  if (exitCode === null) return '#8b949e'
  return exitCode === 0 ? '#3fb950' : '#f85149'
}
