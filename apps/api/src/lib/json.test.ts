import { describe, expect, test } from 'bun:test'
import { safeJsonParse } from './json'

describe('safeJsonParse', () => {
  test('parses valid JSON into the typed value', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonParse<number[]>('[1,2,3]')).toEqual([1, 2, 3])
  })

  test('null / undefined / empty string → null', () => {
    expect(safeJsonParse(null)).toBeNull()
    expect(safeJsonParse(undefined)).toBeNull()
    expect(safeJsonParse('')).toBeNull()
  })

  test('malformed JSON → null (never throws)', () => {
    expect(() => safeJsonParse('{not json')).not.toThrow()
    expect(safeJsonParse('{not json')).toBeNull()
    expect(safeJsonParse('undefined')).toBeNull()
  })

  test('the literal "null" parses to JSON null', () => {
    expect(safeJsonParse('null')).toBeNull()
  })
})
