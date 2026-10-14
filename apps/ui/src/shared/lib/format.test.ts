import { describe, expect, test } from 'bun:test'
import {
  formatUsd,
  formatTokens,
  formatDuration,
  formatElapsed,
  formatRelativeTime,
  formatTimeAgo,
} from '@localixai/plugin-sdk/ui/utilities'

describe('formatUsd', () => {
  test('zero is a bare $0', () => {
    expect(formatUsd(0)).toBe('$0')
  })
  test('sub-cent keeps 4 decimals; sub-dollar 3; else 2 with grouping', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(0.123)).toBe('$0.123')
    expect(formatUsd(1234.5)).toBe('$1,234.50')
  })
})

describe('formatTokens', () => {
  test('plain under 1k, k under 1M, M above', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12_300)).toBe('12.3k')
    expect(formatTokens(4_560_000)).toBe('4.56M')
  })
  test('exact thresholds', () => {
    expect(formatTokens(1_000)).toBe('1.0k')
    expect(formatTokens(1_000_000)).toBe('1.00M')
  })
})

describe('formatDuration', () => {
  test('null / zero / negative render an em dash', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
  })
  test('ms / seconds buckets', () => {
    expect(formatDuration(450)).toBe('450ms')
    expect(formatDuration(1_500)).toBe('1.5s')
  })
  test('minutes, with the 1m60s rounding edge collapsing to 2m', () => {
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(120_000)).toBe('2m')
    expect(formatDuration(119_600)).toBe('2m') // rounds to 120s, not "1m 60s"
  })
})

describe('formatElapsed', () => {
  test('floors to 0s (never an em dash) for zero / negative', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(-5)).toBe('0s')
  })
  test('ms / seconds buckets', () => {
    expect(formatElapsed(450)).toBe('450ms')
    expect(formatElapsed(1_500)).toBe('1.5s')
  })
  test('minutes always show the seconds part, unlike formatDuration', () => {
    expect(formatElapsed(125_000)).toBe('2m 5s')
    expect(formatElapsed(120_000)).toBe('2m 0s')
  })
})

describe('formatRelativeTime', () => {
  const now = Date.now()
  test('under a minute is "now"', () => {
    expect(formatRelativeTime(now - 5_000)).toBe('now')
  })
  test('minutes / hours / days buckets', () => {
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('5m')
    expect(formatRelativeTime(now - 3 * 3_600_000)).toBe('3h')
    expect(formatRelativeTime(now - 2 * 86_400_000)).toBe('2d')
  })
  test('older than a week falls back to an absolute short date', () => {
    const out = formatRelativeTime(now - 30 * 86_400_000)
    expect(out).not.toMatch(/^\d+[mhd]$|^now$/)
  })
})

describe('formatTimeAgo', () => {
  const now = Date.now()
  test('under a minute (and a future timestamp) is "just now"', () => {
    expect(formatTimeAgo(now - 5_000)).toBe('just now')
    expect(formatTimeAgo(now + 5_000)).toBe('just now')
  })
  test('minutes / hours / days buckets carry the "ago" suffix', () => {
    expect(formatTimeAgo(now - 5 * 60_000)).toBe('5m ago')
    expect(formatTimeAgo(now - 3 * 3_600_000)).toBe('3h ago')
    expect(formatTimeAgo(now - 2 * 86_400_000)).toBe('2d ago')
  })
  test('older than a month falls back to an absolute local date', () => {
    const out = formatTimeAgo(now - 45 * 86_400_000)
    expect(out).not.toMatch(/ago$|^just now$/)
    expect(out.length).toBeGreaterThan(0)
  })
  test('a NaN timestamp renders empty', () => {
    expect(formatTimeAgo(Number.NaN)).toBe('')
  })
})
