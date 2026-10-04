// Pure string-distance primitives shared by the patch MATCHING ladder
// (patch-match.ts) and the not-found HINT builders (patch-hints.ts): bounded
// Levenshtein (the server's one implementation, `lib/edit-distance.ts`) + per-line
// block similarity. No IO. Extracted so neither consumer owns the other's primitive.

export { levenshtein } from '../../../../lib/edit-distance'

/** Average per-line trimmed-equality ratio between two blocks (size-tolerant). */
export function blockSimilarity(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let same = 0
  for (let i = 0; i < n; i++) if ((a[i] ?? '').trim() === (b[i] ?? '').trim()) same++
  return same / Math.max(a.length, b.length)
}
