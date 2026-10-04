import { describe, expect, test } from 'bun:test'
import { salientAndSpread, spreadSample } from './spread-sample'

const range = (n: number) => Array.from({ length: n }, (_, index) => index)

describe('spreadSample', () => {
  test('keeps both ends and spreads evenly between them', () => {
    expect(spreadSample(range(10), 3)).toEqual([0, 5, 9])
    expect(spreadSample(range(10), 1)).toEqual([0])
  })

  test('a limit of 0 (or less) selects NOTHING', () => {
    // The completion-context copy answered 0 with one item.
    expect(spreadSample(range(10), 0)).toEqual([])
    expect(spreadSample(range(10), -2)).toEqual([])
  })

  test('no limit, or a limit past the length, keeps everything', () => {
    expect(spreadSample(range(4), undefined)).toEqual([0, 1, 2, 3])
    expect(spreadSample(range(4), 9)).toEqual([0, 1, 2, 3])
  })
})

describe('salientAndSpread', () => {
  const items = range(20).map((index) => ({ index, changedLines: index === 13 ? 900 : 1 }))

  test('never returns more than the limit — including a limit of one', () => {
    for (const limit of [0, 1, 2, 5]) {
      expect(salientAndSpread(items, limit).length).toBe(limit)
    }
  })

  test('the largest change is picked first', () => {
    expect(salientAndSpread(items, 3)[0]?.index).toBe(13)
  })
})
