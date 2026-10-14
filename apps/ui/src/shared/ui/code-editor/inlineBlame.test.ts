import { describe, expect, test } from 'bun:test'
import { formatBlame, formatRelativeTime, type InlineBlameLine } from './inlineBlame'

const NOW = 1_700_000_000_000 // fixed "now" in ms
const nowSec = Math.floor(NOW / 1000)

describe('formatRelativeTime', () => {
  test('just now for very recent', () => {
    expect(formatRelativeTime(nowSec - 10, NOW)).toBe('just now')
  })
  test('minutes / hours / days with singular + plural', () => {
    expect(formatRelativeTime(nowSec - 60, NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(nowSec - 300, NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime(nowSec - 3600, NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(nowSec - 86400, NOW)).toBe('1 day ago')
    expect(formatRelativeTime(nowSec - 3 * 86400, NOW)).toBe('3 days ago')
  })
  test('weeks / months / years', () => {
    expect(formatRelativeTime(nowSec - 14 * 86400, NOW)).toBe('2 weeks ago')
    expect(formatRelativeTime(nowSec - 60 * 86400, NOW)).toBe('2 months ago')
    expect(formatRelativeTime(nowSec - 800 * 86400, NOW)).toBe('2 years ago')
  })
  test('a future timestamp clamps to just now (never negative)', () => {
    expect(formatRelativeTime(nowSec + 500, NOW)).toBe('just now')
  })
})

describe('formatBlame', () => {
  const committed: InlineBlameLine = {
    line: 1,
    author: 'Ada',
    authorTime: nowSec - 3 * 86400,
    summary: 'feat: add login',
    uncommitted: false,
  }

  test('committed line → author, relative date · summary', () => {
    expect(formatBlame(committed, NOW)).toBe('Ada, 3 days ago · feat: add login')
  })

  test('uncommitted line → Not committed yet (no author/date)', () => {
    expect(
      formatBlame({ line: 2, author: '', authorTime: 0, summary: '', uncommitted: true }, NOW),
    ).toBe('Not committed yet')
  })

  test('a long summary is clamped with an ellipsis', () => {
    const long = { ...committed, summary: 'x'.repeat(120) }
    const out = formatBlame(long, NOW)
    expect(out.endsWith('…')).toBe(true)
    // author + date prefix + clamped summary — well under the raw 120 chars.
    expect(out.length).toBeLessThan(100)
  })

  test('missing summary → just author + date', () => {
    expect(formatBlame({ ...committed, summary: '' }, NOW)).toBe('Ada, 3 days ago')
  })
})
