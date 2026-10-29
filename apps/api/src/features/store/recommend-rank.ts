/**
 * HOW RECOMMENDATIONS ARE ORDERED (`docs/internals/store.md`, "Recommendations"). Pure functions.
 *
 * Fusion. Every interest's search scores its hits on one scale (`search-provider.ts`: the meaning
 * z, standardized against the whole collection, with the static score breaking near ties), so the
 * scores are combined, not their ranks — a weighted combination of normalized scores beats rank
 * fusion when the scales agree (Bruch et al., 2022):
 *
 *   fused = max_i(wᵢ·sᵢ) + 0.25 · (Σ_i wᵢ·sᵢ − max_i(wᵢ·sᵢ))
 *
 * so a package one interest finds strongly leads, and one several interests agree on rises. The
 * interest with the largest share is its reason.
 *
 * Diversity. The row is picked greedily, each candidate's score discounted by 0.75 for every
 * package already picked from the same publisher and again for every one found by the same
 * interest: ten packages from one vendor about one file make a worse row than the best few of
 * each. A discount, not a cap, so a row with nothing else to show still fills.
 */

/** What a package that several interests agree on gains from the others. */
const AGREEMENT = 0.25
/** The discount for each earlier pick sharing a publisher, and again an interest. */
const REPEAT = 0.75

export interface Scored {
  key: string
  score: number
  /** The interest with the largest share, as its index: the reason it is recommended. */
  interest: number
}

/** Every interest's hits, `[key, score]` in its order, fused into one list, best first. */
export function fused(
  answers: ReadonlyArray<ReadonlyArray<readonly [string, number]>>,
  weights: readonly number[],
): Scored[] {
  const shares = new Map<string, number[]>()
  answers.forEach((hits, interest) => {
    for (const [key, score] of hits) {
      const of = shares.get(key) ?? Array.from({ length: answers.length }, () => 0)
      // An interest's search names a package once; the best of any repeat stands.
      of[interest] = Math.max(of[interest]!, weights[interest]! * score)
      shares.set(key, of)
    }
  })
  const out: Scored[] = []
  for (const [key, of] of shares) {
    let interest = 0
    for (let at = 1; at < of.length; at++) if (of[at]! > of[interest]!) interest = at
    const best = of[interest]!
    const total = of.reduce((sum, share) => sum + share, 0)
    out.push({ key, score: best + AGREEMENT * (total - best), interest })
  }
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
}

/** The best `limit`, picked so no publisher or interest takes the row while others are found. */
export function diversified<T extends Scored>(
  candidates: readonly T[],
  publisherOf: (candidate: T) => string,
  limit: number,
): T[] {
  const pool = [...candidates]
  const picked: T[] = []
  const byPublisher = new Map<string, number>()
  const byInterest = new Map<number, number>()
  while (picked.length < limit && pool.length > 0) {
    let best = 0
    let bestScore = Number.NEGATIVE_INFINITY
    pool.forEach((candidate, at) => {
      const repeats =
        (byPublisher.get(publisherOf(candidate)) ?? 0) + (byInterest.get(candidate.interest) ?? 0)
      const score = candidate.score * REPEAT ** repeats
      // Strictly greater: of equals, the one the fusion put first.
      if (score > bestScore) {
        best = at
        bestScore = score
      }
    })
    const [chosen] = pool.splice(best, 1)
    picked.push(chosen!)
    const publisher = publisherOf(chosen!)
    byPublisher.set(publisher, (byPublisher.get(publisher) ?? 0) + 1)
    byInterest.set(chosen!.interest, (byInterest.get(chosen!.interest) ?? 0) + 1)
  }
  return picked
}
