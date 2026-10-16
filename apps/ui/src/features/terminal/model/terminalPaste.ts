// Multi-line paste guard for the integrated terminal.
//
// Pasting text that contains newlines into a shell is dangerous: every embedded
// newline is a command boundary, so a multi-line paste can silently run several
// commands at once (and a trailing newline auto-executes the pasted command).
// The policy is trimmed to the two cases that matter here:
//
//  - When the shell is in BRACKETED PASTE MODE it wraps pasted text so nothing is
//    executed until the user reviews it and presses Enter — safe, paste as-is.
//  - A single trailing newline is STRIPPED (paste the command without running it),
//    which also defuses the clipboard-hijack trick where a page swaps the
//    clipboard for `cmd\n` so a paste executes immediately.
//  - Any other genuine multi-line paste asks for confirmation first.
//
// Pure + framework-free so it can be unit-tested; the TerminalPane wires it to the
// xterm paste event and a confirm dialog.

export type PasteDecision =
  | { kind: 'paste'; text: string }
  | { kind: 'confirm'; text: string; lineCount: number; preview: string }

const PREVIEW_LINES = 3
const PREVIEW_LINE_MAX = 40

/** Build the short preview shown in the confirm dialog (first few lines, elided). */
export function buildPastePreview(lines: string[]): string {
  const shown = lines
    .slice(0, PREVIEW_LINES)
    .map((line) => (line.length > PREVIEW_LINE_MAX ? `${line.slice(0, PREVIEW_LINE_MAX)}…` : line))
  if (lines.length > PREVIEW_LINES) shown.push('…')
  return shown.join('\n')
}

/**
 * Decide how to handle pasting `text` given whether the shell has bracketed paste
 * mode enabled. Never throws; empty input is treated as a plain paste.
 */
export function evaluatePaste(text: string, bracketedPasteMode: boolean): PasteDecision {
  const lines = text.split(/\r?\n/)

  // Single line — always safe, no boundary to worry about.
  if (lines.length === 1) return { kind: 'paste', text }

  // The shell will hold the whole paste for review before running anything.
  if (bracketedPasteMode) return { kind: 'paste', text }

  // Command with a single trailing newline → strip it so the user reviews the
  // command and presses Enter themselves (anti clipboard-hijack).
  if (lines.length === 2 && lines[1].trim().length === 0) {
    return { kind: 'paste', text: lines[0] }
  }

  return {
    kind: 'confirm',
    text,
    lineCount: lines.length,
    preview: buildPastePreview(lines),
  }
}
