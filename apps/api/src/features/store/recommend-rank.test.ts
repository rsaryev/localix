import { describe, expect, test } from 'bun:test'

import { diversified, fused } from './recommend-rank'

describe('how recommendations are ordered', () => {
  test('a package two interests agree on rises above one only one interest finds as strongly', () => {
    const order = fused(
      [
        [
          ['plugin:alone', 0.6],
          ['plugin:both', 0.6],
        ],
        [['plugin:both', 0.5]],
      ],
      [1, 0.7],
    )

    expect(order.map((scored) => scored.key)).toEqual(['plugin:both', 'plugin:alone'])
    expect(order[0]!.interest).toBe(0)
  })

  test('the stronger evidence decides the reason: a linked chip over an installed package', () => {
    const [only] = fused([[['plugin:x', 0.5]], [['plugin:x', 0.6]]], [1, 0.7])

    expect(only!.interest).toBe(0)
  })

  test('one publisher with nothing else to show still fills the row', () => {
    const one = Array.from({ length: 4 }, (_, at) => ({
      key: `plugin:${at}`,
      score: 1 - at / 10,
      interest: 0,
      publisher: 'Acme',
    }))

    const row = diversified(one, (candidate) => candidate.publisher, 3)

    expect(row.map((candidate) => candidate.key)).toEqual(['plugin:0', 'plugin:1', 'plugin:2'])
  })
})
