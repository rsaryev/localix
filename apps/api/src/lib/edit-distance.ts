/**
 * Bounded Levenshtein distance — the ONE edit-distance implementation, for the patch tool's fuzzy
 * matching ladder and not-found hints, the slash palette's "did you mean", and the manifest
 * validator's unknown-field typo warnings. It was written three times, and the copies had already
 * drifted (one built a full O(m·n) matrix and only capped on the length difference, so its
 * documented "capped at 3" did not hold).
 *
 * Pure and dependency-free, so a browser leaf (`@localixai/api/slash-catalog`) can import it.
 * Returns the exact distance when it is at most `max`, else a value above `max` (`max + 1` once a
 * whole row exceeds it) — rows are abandoned as soon as every cell exceeds `max`, so a hopeless
 * comparison costs one row, not the whole matrix. Compare the result with `<= max`.
 */
export function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = Array.from<number>({ length: b.length + 1 })
  const curr = Array.from<number>({ length: b.length + 1 })
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
      curr[j] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!
  }
  return prev[b.length]!
}
