import { describe, expect, test } from 'bun:test'

import { judged } from './recommend-eval'

describe('how a recommendation list is judged against what should be in it', () => {
  test('the ideal list scores one; the same packages out of order score less', () => {
    const golden = { must: ['a'], should: ['b'], bad: [] }

    expect(judged(['a', 'b', 'x'], golden).ndcg).toBe(1)
    expect(judged(['b', 'a', 'x'], golden).ndcg).toBeLessThan(1)
    expect(judged(['x', 'b', 'a'], golden).ndcg).toBeLessThan(judged(['b', 'a', 'x'], golden).ndcg)
  })

  test('recall counts what should be there within ten; a bad pick is counted, not hidden', () => {
    const golden = { must: ['a', 'b'], should: ['c', 'd'], bad: ['z'] }
    const eleven = ['a', 'z', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'c']

    expect(judged(eleven, golden)).toMatchObject({ recall: 0.25, bad: ['z'] })
    expect(judged([], golden)).toEqual({ ndcg: 0, recall: 0, bad: [] })
  })
})
