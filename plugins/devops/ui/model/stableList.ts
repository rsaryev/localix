/**
 * Keep the PREVIOUS array when a poll returned the same rows.
 *
 * Every inventory here is re-fetched on a timer, and a fresh array identity makes
 * React re-render every row even when the daemon reported no change — the k8s pod
 * path already avoids this with `podsEqual`, and this is that idea for any row type.
 *
 * Row-wise: an unchanged row keeps its own identity too, so a list where one
 * container flipped state re-renders that row alone.
 *
 * Comparison is a shallow scan of own enumerable keys, which is exactly the shape of
 * these contracts (flat strings/numbers, plus `roles`-style string arrays handled by
 * a nested shallow pass). Anything deeper is treated as changed — a false "changed"
 * costs one render, a false "same" would show stale data.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index])
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => sameValue(left[key], right[key]))
    )
  }
  return false
}

/** True when two rows carry the same field values (one nested level deep). */
export function rowsEqual<Row>(a: Row, b: Row): boolean {
  return sameValue(a, b)
}

/**
 * `next`, with unchanged rows — and the array itself, when nothing changed at all —
 * replaced by the identities already on screen.
 */
export function stableList<Row>(previous: readonly Row[], next: readonly Row[]): Row[] {
  const reconciled = next.map((row, index) => {
    const before = previous[index]
    return before !== undefined && rowsEqual(before, row) ? before : row
  })
  const unchanged =
    previous.length === reconciled.length &&
    reconciled.every((row, index) => row === previous[index])
  return unchanged ? (previous as Row[]) : reconciled
}
