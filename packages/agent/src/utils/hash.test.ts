import { describe, expect, it } from 'bun:test'
import { browserHash, stableStringify, textEncoderByteLength } from './hash'

describe('stableStringify', () => {
  it('is key-order independent (the cache-stability invariant)', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  it('drops undefined values', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }))
  })

  it('sorts nested object keys recursively but preserves array order', () => {
    expect(stableStringify({ x: { c: 3, a: 1 } })).toBe(stableStringify({ x: { a: 1, c: 3 } }))
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]') // arrays are NOT reordered
  })

  it('serializes primitives like JSON', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('hi')).toBe('"hi"')
    expect(stableStringify(42)).toBe('42')
    expect(stableStringify(true)).toBe('true')
  })

  it('always returns a string for undefined (not the value undefined) and avoids the []/[undefined] collision', () => {
    expect(stableStringify(undefined)).toBe('undefined')
    expect(typeof stableStringify(undefined)).toBe('string')
    expect(stableStringify([undefined])).not.toBe(stableStringify([]))
  })
})

describe('browserHash', () => {
  it('does not throw on undefined', () => {
    expect(typeof browserHash(undefined)).toBe('string')
  })

  it('is deterministic and always 16 hex chars', () => {
    const h = browserHash('hello world')
    expect(h).toBe(browserHash('hello world'))
    expect(h).toMatch(/^[0-9a-f]{16}$/)
    expect(browserHash('').length).toBe(16) // padded even for empty input
  })

  it('hashes objects key-order independently (cache keys stay stable)', () => {
    expect(browserHash({ a: 1, b: 2 })).toBe(browserHash({ b: 2, a: 1 }))
  })

  it('distinguishes different inputs', () => {
    expect(browserHash('a')).not.toBe(browserHash('b'))
    expect(browserHash({ a: 1 })).not.toBe(browserHash({ a: 2 }))
    // Note: a string equal to an object's stableStringify hashes the same — fine
    // for ephemeral diagnostic keys (an object input is always serialized first).
    expect(browserHash('{}')).toBe(browserHash({}))
  })
})

describe('textEncoderByteLength', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(textEncoderByteLength('abc')).toBe(3)
    expect(textEncoderByteLength('é')).toBe(2)
    expect(textEncoderByteLength('😀')).toBe(4)
    expect(textEncoderByteLength('')).toBe(0)
  })
})
