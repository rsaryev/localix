import { describe, expect, it } from 'bun:test'
import { isoFromUnixSeconds, toolNumber } from './tool-number'

describe('toolNumber', () => {
  it('keeps four significant digits below 1000 and one decimal above', () => {
    expect(toolNumber(63.21987)).toBe('63.22')
    expect(toolNumber(0.000123456)).toBe('0.0001235')
    expect(toolNumber(64_123.456)).toBe('64123.5')
    expect(toolNumber(-1234.56)).toBe('-1234.6')
  })
})

describe('isoFromUnixSeconds', () => {
  it('reads seconds, not milliseconds', () => {
    expect(isoFromUnixSeconds(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })
})
