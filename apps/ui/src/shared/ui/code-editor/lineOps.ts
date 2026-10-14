// Whole-line text operations: sort lines ascending / descending, trim trailing
// whitespace, join lines.
// The transforms below are PURE (string in / string out, no editor or DOM), so they
// are unit-testable and shared by save-cleanup paths outside the editor runtime.

/** Sort an array of lines lexicographically; `descending` reverses the order. Pure. */
export function sortLines(lines: readonly string[], descending: boolean): string[] {
  const sorted = [...lines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return descending ? sorted.reverse() : sorted
}

/** Strip trailing spaces/tabs from every line, preserving the lines themselves. Pure. */
export function trimTrailingWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
}

/**
 * Guarantee the text ends with exactly one trailing newline.
 * Pure + idempotent: empty text stays empty (no
 * newline is added to a zero-byte file); text already ending in a single `\n`
 * is returned unchanged; text with no trailing newline gets one; a run of
 * trailing blank lines collapses to a single `\n`. A `\r\n` line ending is
 * preserved (the final newline matches the last existing one).
 */
export function ensureFinalNewline(text: string): string {
  if (text.length === 0) return text
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  // Strip any run of trailing CR/LF, then append exactly one line ending.
  const trimmed = text.replace(/(\r?\n)+$/, '')
  return trimmed + eol
}

/**
 * Join lines into one, collapsing the whitespace at each seam to a single space
 * (leading indentation of the following line is dropped, trailing space of the
 * preceding line trimmed). Pure. Empty lines collapse
 * away so a blank line between two lines does not leave a double space.
 */
export function joinLines(lines: readonly string[]): string {
  return lines
    .flatMap((line, i) => {
      const trimmed = i === 0 ? line.replace(/\s+$/, '') : line.replace(/^\s+/, '')
      return i === 0 || trimmed.length > 0 ? [trimmed] : []
    })
    .join(' ')
}
