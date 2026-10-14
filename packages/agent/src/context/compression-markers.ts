/** Shared placeholder text used by elision emitters and context-recovery checks. */
export const ELISION_MARKER = 'elided to save context'

/**
 * A marker counts only when an unclosed `[` precedes it on the same line.
 * Plain prose or source code mentioning the phrase must not mark content as compressed.
 * If an occurrence is outside brackets, keep looking for a later placeholder.
 */
export function carriesMarker(text: string, marker: string): boolean {
  let from = 0
  for (;;) {
    const i = text.indexOf(marker, from)
    if (i < 0) return false
    // Walk back to the nearest `[` without crossing `]` or a line break.
    let j = i - 1
    while (j >= 0 && text[j] !== '[' && text[j] !== ']' && text[j] !== '\n') j--
    if (j >= 0 && text[j] === '[') return true
    from = i + marker.length
  }
}
