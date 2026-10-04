import { useState } from 'react'

/**
 * Typeahead for tree sidebars: typing printable characters while
 * a tree row has focus jumps focus to the next visible row whose NAME starts
 * with the accumulated prefix (case-insensitive). The buffer resets after a
 * short pause; repeating the same single character cycles through its matches;
 * the search wraps around the end of the tree.
 *
 * Split like the roving-focus helper: a pure, clock-injectable core
 * (`createTypeahead`) plus a thin DOM hook (`useTreeTypeahead`) reading rows
 * from `[data-tree-path]` / `data-tree-name` attributes.
 */

/** A visible tree row: `path` identifies it, `name` is its visible label. */
export interface TypeaheadRow {
  path: string
  name: string
}

/** How long (ms) the prefix buffer survives between keystrokes. */
export const TYPEAHEAD_TIMEOUT_MS = 600

export interface Typeahead {
  /**
   * Feed one printable character. Returns the path of the row focus should
   * jump to, or null when nothing matches the accumulated prefix.
   */
  handleChar(char: string, rows: readonly TypeaheadRow[], currentPath: string | null): string | null
  /** Drop the accumulated buffer (e.g. when the tree unmounts focus). */
  reset(): void
}

/**
 * Pure typeahead state machine. `now` is injectable so tests never touch
 * `Date.now`. Matching rules (the ARIA listbox pattern):
 * - characters typed within `timeoutMs` of each other accumulate into a prefix;
 * - a buffer of the SAME character repeated collapses to that single character,
 *   so pressing e.g. `s` `s` `s` cycles through the `s…` rows;
 * - the search starts at the row AFTER the current one and wraps; for a
 *   multi-character prefix the current row is the LAST candidate (so a still-
 *   matching row keeps focus while you extend the prefix), for a single
 *   character it is excluded entirely (so repeats always advance).
 */
export function createTypeahead(opts: { timeoutMs?: number; now?: () => number } = {}): Typeahead {
  const timeoutMs = opts.timeoutMs ?? TYPEAHEAD_TIMEOUT_MS
  const now = opts.now ?? Date.now
  let buffer = ''
  let lastAt = -Infinity

  return {
    handleChar(char, rows, currentPath) {
      const t = now()
      if (t - lastAt > timeoutMs) buffer = ''
      lastAt = t
      buffer += char.toLowerCase()
      if (rows.length === 0) return null
      const repeated = buffer.length > 1 && buffer.split('').every((c) => c === buffer[0])
      const prefix = repeated ? buffer[0]! : buffer
      const currentIndex = currentPath === null ? -1 : rows.findIndex((r) => r.path === currentPath)
      // Candidate order: the row after the current one first, wrapping around.
      const ordered = rows.map((_, i) => rows[(currentIndex + 1 + i) % rows.length]!)
      const candidates =
        prefix.length === 1 ? ordered.filter((r) => r.path !== currentPath) : ordered
      const match = candidates.find((r) => r.name.toLowerCase().startsWith(prefix))
      return match ? match.path : null
    },
    reset() {
      buffer = ''
      lastAt = -Infinity
    },
  }
}

const ROW_SELECTOR = '[data-tree-path]'

/** Visible label for a row element: `data-tree-name`, else the path basename. */
const rowNameOf = (el: HTMLElement): string => {
  const path = el.dataset.treePath ?? ''
  return el.dataset.treeName ?? (path.split('/').pop() || path)
}

/**
 * Delegated typeahead keydown handler for a tree container. Call it AFTER
 * `treeNavKeyDown` in the container's onKeyDown. It only reacts to unmodified
 * single-character keys (Space excluded — it activates the focused row button)
 * when focus sits on a `[data-tree-path]` row (the inline rename input is
 * therefore ignored) and nothing upstream already handled the event; a match
 * focuses the target row exactly like arrow-key navigation does.
 */
export function useTreeTypeahead(): (e: React.KeyboardEvent<HTMLElement>) => void {
  const [typeahead] = useState(() => createTypeahead())
  return (e) => {
    if (e.defaultPrevented) return
    if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return
    const target = e.target
    if (!(target instanceof Element)) return
    const currentRow = target.closest<HTMLElement>(ROW_SELECTOR)
    const currentPath = currentRow?.dataset.treePath
    if (!currentRow || !currentPath) return
    const elements = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR))
    const rows = elements.map((el) => ({ path: el.dataset.treePath ?? '', name: rowNameOf(el) }))
    const match = typeahead.handleChar(e.key, rows, currentPath)
    if (match === null) return
    e.preventDefault()
    elements[rows.findIndex((r) => r.path === match)]?.focus()
  }
}
