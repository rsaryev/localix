import { describe, expect, test } from 'bun:test'

import {
  asRecord,
  baseName,
  countNonEmptyLines,
  formatBytes,
  numField,
  pretty,
  strField,
  truncate,
} from './format'

describe('baseName', () => {
  test('returns the last path segment', () => {
    expect(baseName('src/foo/bar.ts')).toBe('bar.ts')
    expect(baseName('bar.ts')).toBe('bar.ts')
  })
  test('strips trailing slashes', () => {
    expect(baseName('src/foo/')).toBe('foo')
    expect(baseName('/a/b///')).toBe('b')
  })
})

describe('formatBytes', () => {
  test('scales B / KB / MB at 1024 boundaries', () => {
    expect(formatBytes(532)).toBe('532 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB')
  })
  test('negative or non-finite → empty string', () => {
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
    expect(formatBytes(Infinity)).toBe('')
  })
})

describe('countNonEmptyLines', () => {
  test('counts only non-blank lines', () => {
    expect(countNonEmptyLines('')).toBe(0)
    expect(countNonEmptyLines('a\n\nb\n   \nc')).toBe(3)
    expect(countNonEmptyLines('   ')).toBe(0)
  })
})

describe('truncate', () => {
  test('passes through when within max, else clips with an ellipsis to max length', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello world', 5)).toBe('hell…')
    expect(truncate('hello world', 5).length).toBe(5)
  })
})

describe('strField / numField', () => {
  test('return the value only when the type matches', () => {
    expect(strField({ a: 'x' }, 'a')).toBe('x')
    expect(strField({ a: 1 }, 'a')).toBeUndefined()
    expect(numField({ a: 1 }, 'a')).toBe(1)
    expect(numField({ a: 'x' }, 'a')).toBeUndefined()
  })
  test('non-object / missing key → undefined', () => {
    expect(strField(null, 'a')).toBeUndefined()
    expect(strField('str', 'a')).toBeUndefined()
    expect(numField({ b: 1 }, 'a')).toBeUndefined()
  })
})

describe('asRecord', () => {
  test('objects pass through, primitives/null become undefined', () => {
    const o = { a: 1 }
    expect(asRecord(o)).toBe(o)
    expect(asRecord(null)).toBeUndefined()
    expect(asRecord(42)).toBeUndefined()
    expect(asRecord('x')).toBeUndefined()
  })
})

describe('pretty', () => {
  test('strings pass through verbatim', () => {
    expect(pretty('already a string')).toBe('already a string')
  })
  test('objects render as indented JSON', () => {
    expect(pretty({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(pretty(undefined)).toBe('{}')
  })
  test('circular structures fall back to String() instead of throwing', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => pretty(circular)).not.toThrow()
    expect(pretty(circular)).toBe('[object Object]')
  })
})
