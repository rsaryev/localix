/**
 * The one typeahead buffer behind every kit list that jumps by typed prefix — tree rows, a closed
 * `Select`, a coordinate menu. Each surface supplies its own labels and timeout; the matching
 * rules (the ARIA listbox pattern) are shared:
 * - characters typed within `timeoutMs` of each other accumulate into a prefix;
 * - a buffer of the SAME character repeated collapses to that single character, so pressing
 *   `s` `s` `s` cycles through the `s…` entries;
 * - a single character searches from the entry AFTER the current one, wrapping, and never
 *   lands on the current entry (so repeats always advance);
 * - a longer prefix searches from the current entry itself, so a still-matching entry keeps
 *   its place while the prefix is extended.
 *
 * `now` is injectable so tests never touch `Date.now`.
 */
export interface TypeaheadBuffer {
  /**
   * Feed one printable character. Returns the index of the entry to move to, or -1 when nothing
   * matches the accumulated prefix. `currentIndex` is -1 when no entry is current.
   */
  handleChar(char: string, labels: readonly string[], currentIndex: number): number
  /** Drop the accumulated prefix. */
  reset(): void
}

export function createTypeaheadBuffer(
  opts: { timeoutMs: number; now?: () => number } = { timeoutMs: 600 },
): TypeaheadBuffer {
  const now = opts.now ?? Date.now
  let buffer = ''
  let lastAt = -Infinity

  return {
    handleChar(char, labels, currentIndex) {
      const t = now()
      if (t - lastAt > opts.timeoutMs) buffer = ''
      lastAt = t
      buffer += char.toLocaleLowerCase()
      const count = labels.length
      if (count === 0) return -1
      const repeated = buffer.length > 1 && Array.from(buffer).every((c) => c === buffer[0])
      const prefix = repeated ? buffer[0]! : buffer
      const single = prefix.length === 1
      const start = single ? currentIndex + 1 : Math.max(currentIndex, 0)
      for (let step = 0; step < count; step++) {
        const index = (start + step) % count
        if (single && index === currentIndex) continue
        if (labels[index]!.toLocaleLowerCase().startsWith(prefix)) return index
      }
      return -1
    },
    reset() {
      buffer = ''
      lastAt = -Infinity
    },
  }
}
