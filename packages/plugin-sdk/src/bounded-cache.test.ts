import { describe, expect, test } from 'bun:test'

import { createBoundedCache } from './bounded-cache'

describe('createBoundedCache', () => {
  test('evicts the least recently used entry, and a hit counts as a use', () => {
    const cache = createBoundedCache<string, number>({ maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
  })

  test('peek and has inspect without keeping an entry alive', () => {
    const cache = createBoundedCache<string, number>({ maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.peek('a')).toBe(1)
    expect(cache.has('a')).toBe(true)
    cache.set('c', 3)
    expect(cache.has('a')).toBe(false)
  })

  test('bounds total weight and releases the weight of what it drops or replaces', () => {
    const cache = createBoundedCache<string, string>({
      maxEntries: 10,
      maxWeight: 10,
      weigh: (value) => value.length,
    })
    cache.set('a', 'xxxx')
    cache.set('b', 'yyyy')
    cache.set('c', 'zzzz')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.weight).toBe(8)
    cache.set('b', 'y')
    expect(cache.weight).toBe(5)
    cache.delete('c')
    expect(cache.weight).toBe(1)
  })

  test('an entry heavier than the whole budget is refused and still drops the old value', () => {
    const cache = createBoundedCache<string, string>({
      maxEntries: 10,
      maxWeight: 4,
      weigh: (value) => value.length,
    })
    cache.set('small', 'xx')
    cache.set('k', 'ok')
    expect(cache.set('k', 'too long')).toBe(false)
    expect(cache.get('k')).toBeUndefined()
    expect(cache.get('small')).toBe('xx')
    expect(cache.weight).toBe(2)
  })

  test('onEvict sees what the bound pushed out, never a delete, replacement or clear', () => {
    const evicted: Array<[string, number]> = []
    const cache = createBoundedCache<string, number>({
      maxEntries: 2,
      onEvict: (key, value) => evicted.push([key, value]),
    })
    cache.set('a', 1)
    cache.set('a', 10)
    cache.set('b', 2)
    cache.delete('b')
    cache.set('b', 2)
    cache.set('c', 3)
    expect(evicted).toEqual([['a', 10]])
    cache.clear()
    expect(evicted).toEqual([['a', 10]])
  })

  test('deleteWhere invalidates by key or value; clear resets the weight', () => {
    const cache = createBoundedCache<string, number>({ maxEntries: 10, weigh: () => 3 })
    cache.set('s1', 1)
    cache.set('s1:lane', 2)
    cache.set('s2', 3)
    cache.deleteWhere((_value, key) => key.startsWith('s1'))
    expect(cache.size).toBe(1)
    expect(cache.weight).toBe(3)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.weight).toBe(0)
  })
})
