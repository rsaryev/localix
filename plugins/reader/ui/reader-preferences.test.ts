import { expect, test } from 'bun:test'
import { DEFAULT_READER_PREFERENCES, normalizeReaderPreferences } from './model'

test('stored numeric strings fall back and valid numeric bounds retain existing rounding', () => {
  expect(
    normalizeReaderPreferences({ fontSize: '26', autoScrollSpeed: '72', speedReadingWpm: '600' }),
  ).toEqual(DEFAULT_READER_PREFERENCES)
  expect(
    normalizeReaderPreferences({ fontSize: 14.5, autoScrollSpeed: 8.5, speedReadingWpm: 112.5 }),
  ).toMatchObject({ fontSize: 15, autoScrollSpeed: 9, speedReadingWpm: 125 })
  expect(
    normalizeReaderPreferences({
      fontSize: -Infinity,
      autoScrollSpeed: Infinity,
      speedReadingWpm: Infinity,
    }),
  ).toMatchObject({ fontSize: 14, autoScrollSpeed: 72, speedReadingWpm: 600 })
})

test('normalization produces a fresh object with its own fallback values', () => {
  const previous = DEFAULT_READER_PREFERENCES.fontSize
  try {
    DEFAULT_READER_PREFERENCES.fontSize = 26
    const first = normalizeReaderPreferences(null)
    const second = normalizeReaderPreferences({})
    expect(first.fontSize).toBe(18)
    expect(second).toEqual(first)
    expect(first).not.toBe(second)
    expect(first).not.toBe(DEFAULT_READER_PREFERENCES)
  } finally {
    DEFAULT_READER_PREFERENCES.fontSize = previous
  }
})

test('non-finite numeric handling remains field-specific', () => {
  const restored = normalizeReaderPreferences({
    fontSize: Number.NaN,
    autoScrollSpeed: Number.NaN,
    speedReadingWpm: Number.NaN,
    lineHeight: Number.NaN,
    measure: Number.NaN,
  })
  expect(Number.isNaN(restored.fontSize)).toBe(true)
  expect(Number.isNaN(restored.autoScrollSpeed)).toBe(true)
  expect(Number.isNaN(restored.speedReadingWpm)).toBe(true)
  expect(restored.lineHeight).toBe(1.75)
  expect(restored.measure).toBe(70)
})
