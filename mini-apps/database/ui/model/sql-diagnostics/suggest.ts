/**
 * "Did you mean …" for a name the catalog does not have.
 *
 * An error that only says `usres` does not exist leaves the user to go find the right spelling;
 * the right spelling is already in the catalog. Only a CLOSE match is offered — a distance
 * scaled to the name's length — because a far-fetched suggestion is worse than none.
 */
/**
 * Edit distance where swapping two neighbours is ONE edit (optimal string alignment). Plain
 * Levenshtein prices `usres` → `users` at two, and the most common typo went unsuggested.
 */
function distance(a: string, b: string): number {
  let before = Array.from({ length: b.length + 1 }, () => 0)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, before[j - 2]! + 1)
      }
      row.push(best)
    }
    before = prev
    prev = row
  }
  return prev[b.length]!
}

export function closestName(name: string, candidates: readonly string[]): string | undefined {
  const target = name.toLowerCase()
  const budget = Math.max(1, Math.floor(target.length / 3))
  let best: { name: string; score: number } | undefined
  for (const candidate of candidates) {
    const score = distance(target, candidate.toLowerCase())
    if (score <= budget && (!best || score < best.score)) best = { name: candidate, score }
  }
  return best?.name
}
