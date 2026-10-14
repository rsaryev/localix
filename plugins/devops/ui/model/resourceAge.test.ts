import { describe, expect, test } from 'bun:test'

import { formatResourceAge } from './resourceAge'

describe('formatResourceAge', () => {
  const now = Date.parse('2026-07-06T12:00:00Z')
  test('renders compact units', () => {
    expect(formatResourceAge('2026-07-06T11:59:30Z', now)).toBe('30s')
    expect(formatResourceAge('2026-07-06T11:30:00Z', now)).toBe('30m')
    expect(formatResourceAge('2026-07-06T09:00:00Z', now)).toBe('3h')
    expect(formatResourceAge('2026-07-03T12:00:00Z', now)).toBe('3d')
  })
  test('invalid timestamp → empty', () => {
    expect(formatResourceAge('', now)).toBe('')
  })
})
