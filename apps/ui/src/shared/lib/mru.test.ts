import { describe, it, expect } from 'bun:test'
import { pushMru } from './mru'

describe('pushMru', () => {
  it('puts a new item at the front', () => {
    expect(pushMru(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('moves an existing item to the front (dedupe, no growth)', () => {
    expect(pushMru(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(pushMru(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('keeps an already-front item in place', () => {
    expect(pushMru(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })

  it('caps the result to `max`, dropping the oldest', () => {
    expect(pushMru(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
    expect(pushMru(['a', 'b'], 'c', 2)).toEqual(['c', 'a'])
  })

  it('does not grow a full list when re-touching an existing item', () => {
    expect(pushMru(['a', 'b', 'c'], 'b', 3)).toEqual(['b', 'a', 'c'])
  })

  it('treats max=0 as an empty cap and clamps negatives to 0', () => {
    expect(pushMru(['a'], 'b', 0)).toEqual([])
    expect(pushMru(['a'], 'b', -1)).toEqual([])
  })

  it('returns a fresh array without mutating the input', () => {
    const input = ['a', 'b']
    const out = pushMru(input, 'a')
    expect(out).not.toBe(input)
    expect(input).toEqual(['a', 'b'])
  })

  it('dedupes by reference identity for objects', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    expect(pushMru([a, b], a)).toEqual([a, b]) // same ref → moved to front
    const cloneOfA = { id: 1 }
    expect(pushMru([a, b], cloneOfA)).toEqual([cloneOfA, a, b]) // different ref → new entry
  })

  it('dedupes by value when given an `isSame` comparator', () => {
    const same = (x: { id: number }, y: { id: number }) => x.id === y.id
    const a = { id: 1 }
    const b = { id: 2 }
    const cloneOfA = { id: 1 }
    // value-equal but a different reference → still deduped, and the NEW object wins
    expect(pushMru([a, b], cloneOfA, undefined, same)).toEqual([cloneOfA, b])
    expect(pushMru([a, b], cloneOfA, undefined, same)[0]).toBe(cloneOfA)
  })

  it('still caps when deduping by value', () => {
    const same = (x: { id: number }, y: { id: number }) => x.id === y.id
    expect(pushMru([{ id: 1 }, { id: 2 }], { id: 3 }, 2, same)).toEqual([{ id: 3 }, { id: 1 }])
  })
})
