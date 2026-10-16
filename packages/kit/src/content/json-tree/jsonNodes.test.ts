import { describe, expect, it } from 'bun:test'
import { jsonEntries, jsonKind, jsonSummary } from './jsonNodes'

describe('jsonKind', () => {
  it('classifies each JSON type', () => {
    expect(jsonKind({})).toBe('object')
    expect(jsonKind([])).toBe('array')
    expect(jsonKind('x')).toBe('string')
    expect(jsonKind(3)).toBe('number')
    expect(jsonKind(true)).toBe('boolean')
    expect(jsonKind(null)).toBe('null')
    expect(jsonKind(undefined)).toBe('null')
  })
})

describe('jsonSummary', () => {
  it('counts array/object members, empty for primitives', () => {
    expect(jsonSummary([1, 2, 3])).toBe('[3]')
    expect(jsonSummary({ a: 1, b: 2 })).toBe('{2}')
    expect(jsonSummary('x')).toBe('')
  })
})

describe('jsonEntries', () => {
  it('yields index/key pairs; [] for primitives', () => {
    expect(jsonEntries(['a', 'b'])).toEqual([
      [0, 'a'],
      [1, 'b'],
    ])
    expect(jsonEntries({ k: 1 })).toEqual([['k', 1]])
    expect(jsonEntries(5)).toEqual([])
  })
})
