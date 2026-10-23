import { expect, test } from 'bun:test'
import { fitFontSize } from './fit-text'

test('auto-sized text takes the largest size that fits, within its bounds', () => {
  const checked: number[] = []
  const fits = (limit: number) => (px: number) => (checked.push(px), px <= limit)
  expect(fitFontSize(fits(23), 12, 32)).toBe(23)
  // A binary search, not a walk down one pixel at a time.
  expect(checked.length).toBeLessThanOrEqual(6)
  expect(fitFontSize(fits(99), 12, 32)).toBe(32)
  // Text too long for the note keeps the legible minimum and scrolls.
  expect(fitFontSize(fits(4), 12, 32)).toBe(12)
})
