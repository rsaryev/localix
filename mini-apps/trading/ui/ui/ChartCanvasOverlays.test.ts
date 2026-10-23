import { describe, expect, test } from 'bun:test'

import { measureDuration } from './ChartCanvasOverlays'

describe('measureDuration', () => {
  test('formats minute, hour, and day spans compactly', () => {
    expect(measureDuration(3, 15 * 60)).toBe('45m')
    expect(measureDuration(5, 30 * 60)).toBe('2h 30m')
    expect(measureDuration(28, 60 * 60)).toBe('1d 4h')
  })

  test('omits empty and invalid spans', () => {
    expect(measureDuration(0, 60)).toBeNull()
    expect(measureDuration(4, null)).toBeNull()
  })
})
