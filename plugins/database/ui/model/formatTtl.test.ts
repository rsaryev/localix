import { describe, expect, it } from 'bun:test'
import { formatTtl } from './formatTtl'

describe('formatTtl', () => {
  it('picks the largest sensible unit', () => {
    expect(formatTtl(45)).toBe('45s')
    expect(formatTtl(90)).toBe('1m')
    expect(formatTtl(3600)).toBe('1h')
    expect(formatTtl(90000)).toBe('1d')
  })
  it('clamps non-positive / sub-second to 0s', () => {
    expect(formatTtl(0)).toBe('0s')
    expect(formatTtl(-5)).toBe('0s')
    expect(formatTtl(0.4)).toBe('0s')
  })
})
