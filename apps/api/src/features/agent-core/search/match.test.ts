import { describe, it, expect } from 'bun:test'
import { bestFieldScore } from './match'

describe('bestFieldScore', () => {
  it('takes the strongest field', () =>
    expect(bestFieldScore(['zzz', 'auth stuff'], 'auth')).toBe(0.9))
  it('skips nullish fields', () =>
    expect(bestFieldScore([null, undefined, 'auth'], 'auth')).toBe(1))
  it('no match anywhere = 0', () => expect(bestFieldScore(['a', 'b'], 'zzz')).toBe(0))
})
