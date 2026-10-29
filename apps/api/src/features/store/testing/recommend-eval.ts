/**
 * HOW A RECOMMENDATION LIST IS JUDGED (`docs/internals/store.md`, "Measuring recommendations"):
 * against a golden case's packages — those that must be there (relevance 2), those that should
 * (1), and those that must not. Within the first ten, as the Store shows them:
 *
 * - nDCG@10: the gains `2^rel − 1`, discounted by `log2(rank + 1)`, over the ideal order's.
 * - recall@10: the share of must and should packages shown.
 * - bad: the packages shown that must not be.
 */

export interface Golden {
  must: readonly string[]
  should: readonly string[]
  bad: readonly string[]
}

const CUTOFF = 10

const gainOf = (relevance: number) => 2 ** relevance - 1
const discounted = (gains: readonly number[]) =>
  gains.reduce((sum, gain, at) => sum + gain / Math.log2(at + 2), 0)

export function judged(
  ids: readonly string[],
  golden: Golden,
): { ndcg: number; recall: number; bad: string[] } {
  const top = ids.slice(0, CUTOFF)
  const relevance = (id: string) =>
    golden.must.includes(id) ? 2 : golden.should.includes(id) ? 1 : 0
  const ideal = discounted(
    [...golden.must.map(() => 2), ...golden.should.map(() => 1)].slice(0, CUTOFF).map(gainOf),
  )
  const wanted = [...golden.must, ...golden.should]
  return {
    ndcg: ideal ? discounted(top.map((id) => gainOf(relevance(id)))) / ideal : 0,
    recall: wanted.length ? top.filter((id) => wanted.includes(id)).length / wanted.length : 0,
    bad: top.filter((id) => golden.bad.includes(id)),
  }
}
