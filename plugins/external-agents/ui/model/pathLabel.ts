/**
 * Path shortening for roster rows.
 *
 * A cwd is only useful for telling two sessions apart, and the distinguishing part of an agent
 * cwd is almost always its TAIL (`~/code/app/packages/api`), not its head. CSS `truncate` cuts the
 * tail, so it would hide exactly the informative half — hence a middle ellipsis here, with the
 * full path kept for the row's `title` attribute.
 */

const ELLIPSIS = '…'

/**
 * Shorten to at most `max` characters, keeping both ends. Segment-aware: the cut lands on a `/`
 * boundary whenever one is available, because a path sliced mid-segment reads as a different path.
 */
export function middleEllipsis(path: string, max = 48): string {
  if (path.length <= max) return path
  const segments = path.split('/')
  if (segments.length > 2) {
    // An absolute path's first segment is '' — that is intentional, it re-emits the leading '/'.
    const head = segments[0] ?? ''
    const tailParts: string[] = []
    let used = head.length + ELLIPSIS.length + 1
    for (let i = segments.length - 1; i > 0; i -= 1) {
      const segment = segments[i] ?? ''
      if (used + segment.length + 1 > max) break
      tailParts.unshift(segment)
      used += segment.length + 1
    }
    if (tailParts.length > 0) return `${head}/${ELLIPSIS}/${tailParts.join('/')}`
  }
  // No usable boundary (one long segment): fall back to a raw character-wise middle cut.
  const keep = Math.max(1, Math.floor((max - ELLIPSIS.length) / 2))
  return `${path.slice(0, keep)}${ELLIPSIS}${path.slice(path.length - keep)}`
}

/** Tail of a source path — enough provenance for a row, full value goes in the tooltip. */
export function basename(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? path : path.slice(at + 1)
}
