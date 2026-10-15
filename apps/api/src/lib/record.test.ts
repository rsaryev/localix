import { describe, expect, test } from 'bun:test'
import { isRecord } from './record'

describe('isRecord', () => {
  test('accepts plain objects and rejects null, arrays and primitives', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })
})
