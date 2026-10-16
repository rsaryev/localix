import { describe, expect, test } from 'bun:test'
import { formatByteRate, parseDockerBytePair, parseDockerBytes } from './bytes'

describe('parseDockerBytes', () => {
  test('decimal units, as `NetIO` and `BlockIO` are printed', () => {
    expect(parseDockerBytes('1.2kB')).toBe(1_200)
    expect(parseDockerBytes('4.1MB')).toBe(4_100_000)
    expect(parseDockerBytes('2GB')).toBe(2_000_000_000)
    expect(parseDockerBytes('0B')).toBe(0)
  })

  test('binary units, as `MemUsage` is printed', () => {
    // Docker uses BOTH systems in the same stats row; conflating them is a 2.4%+ error.
    expect(parseDockerBytes('12MiB')).toBe(12 * 1024 * 1024)
    expect(parseDockerBytes('2GiB')).toBe(2 * 1024 ** 3)
    expect(parseDockerBytes('1.5KiB')).toBe(1_536)
  })

  test('byte counts come back integral, not as float drift', () => {
    // `4.1 * 1000 ** 2` is 4099999.9999999995 in IEEE754.
    expect(Number.isInteger(parseDockerBytes('4.1MB'))).toBe(true)
    expect(Number.isInteger(parseDockerBytes('1.1GiB'))).toBe(true)
  })

  test("Docker's unavailable placeholder is null, NOT zero", () => {
    for (const value of ['--', '-', '', '   ']) {
      expect(parseDockerBytes(value)).toBeNull()
    }
  })

  test('unreadable input is null rather than a wrong number', () => {
    expect(parseDockerBytes('lots')).toBeNull()
    expect(parseDockerBytes('12ZB')).toBeNull()
    expect(parseDockerBytes(undefined)).toBeNull()
    expect(parseDockerBytes(Number.NaN)).toBeNull()
  })

  test('a bare number is already bytes', () => {
    expect(parseDockerBytes('4096')).toBe(4096)
    expect(parseDockerBytes(4096)).toBe(4096)
  })
})

describe('parseDockerBytePair', () => {
  test('splits the `<in> / <out>` column Docker prints', () => {
    expect(parseDockerBytePair('1.2kB / 0B')).toEqual([1_200, 0])
    expect(parseDockerBytePair('4.1MB / 512kB')).toEqual([4_100_000, 512_000])
  })

  test('each side is judged independently', () => {
    expect(parseDockerBytePair('4.1MB / --')).toEqual([4_100_000, null])
  })

  test('a wholly unavailable column is a null pair, not a zeroed one', () => {
    expect(parseDockerBytePair('--')).toEqual([null, null])
    expect(parseDockerBytePair('-- / --')).toEqual([null, null])
    expect(parseDockerBytePair(undefined)).toEqual([null, null])
  })
})

describe('formatByteRate', () => {
  test('decimal units, matching the counter they were derived from', () => {
    expect(formatByteRate(0)).toBe('0 B/s')
    expect(formatByteRate(940)).toBe('940 B/s')
    expect(formatByteRate(1_200)).toBe('1.2 kB/s')
    expect(formatByteRate(4_100_000)).toBe('4.1 MB/s')
    expect(formatByteRate(2_500_000_000)).toBe('2.5 GB/s')
  })
  test('large values inside a unit drop the decimal', () => {
    expect(formatByteRate(45_000)).toBe('45 kB/s')
  })
  test('nonsense is blank rather than a bogus rate', () => {
    expect(formatByteRate(Number.NaN)).toBe('')
    expect(formatByteRate(-1)).toBe('')
  })
})
