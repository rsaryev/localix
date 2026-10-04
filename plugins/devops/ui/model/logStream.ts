function splitLines(value: string): string[] {
  if (!value) return []
  const normalized = value.endsWith('\n') ? value.slice(0, -1) : value
  return normalized ? normalized.split(/\r?\n/) : []
}

/**
 * Merge an overlapping runtime-log page into the retained buffer.
 *
 * Poll fallbacks request a few seconds of overlap. Matching the previous suffix
 * to the incoming prefix preserves legitimate duplicate messages while removing
 * only the replayed overlap. The buffer stays bounded for long-running tabs.
 */
export function mergeLogSnapshots(previous: string, incoming: string, maxLines = 2_000): string {
  const before = splitLines(previous)
  const next = splitLines(incoming)
  if (next.length === 0) return previous
  if (before.length === 0) return next.slice(-maxLines).join('\n')

  const maxOverlap = Math.min(before.length, next.length)
  let overlap = 0
  for (let size = maxOverlap; size > 0; size -= 1) {
    let matches = true
    for (let index = 0; index < size; index += 1) {
      if (before[before.length - size + index] !== next[index]) {
        matches = false
        break
      }
    }
    if (matches) {
      overlap = size
      break
    }
  }

  return [...before, ...next.slice(overlap)].slice(-maxLines).join('\n')
}
