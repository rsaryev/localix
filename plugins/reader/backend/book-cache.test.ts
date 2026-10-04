import { describe, expect, test } from 'bun:test'
import { BookCache } from './book-cache'

const book = (bytes: number) => ({ fingerprint: 'f', parsed: bytes })

describe('parsed-book cache', () => {
  test('is bounded by bytes, not by count', () => {
    // 24 entries of any size was the old bound; one CBZ can be hundreds of MB.
    const cache = new BookCache<number>((n) => n, 100)
    cache.set('a', book(60))
    cache.set('b', book(60))
    expect(cache.size).toBe(1)
    expect(cache.bytes).toBe(60)
    expect(cache.get('a')).toBeUndefined()
  })

  test('evicts the least recently USED book, so a hit keeps its place', () => {
    const cache = new BookCache<number>((n) => n, 100)
    cache.set('a', book(40))
    cache.set('b', book(40))
    cache.get('a')
    cache.set('c', book(40))
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
  })

  test('a book larger than the whole budget is served uncached, evicting nothing', () => {
    const cache = new BookCache<number>((n) => n, 100)
    cache.set('a', book(40))
    cache.set('huge', book(500))
    expect(cache.get('huge')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
  })

  test('replacing a key does not double-count it', () => {
    const cache = new BookCache<number>((n) => n, 100)
    cache.set('a', book(40))
    cache.set('a', book(50))
    expect(cache.bytes).toBe(50)
  })
})
