import { describe, expect, test } from 'bun:test'
import { ATTRIBUTION_PREFIX, CALLOUT_KINDS, parseCalloutMarker } from './dialect'

describe('parseCalloutMarker', () => {
  test('reads every kind in any case and consumes its line', () => {
    for (const kind of CALLOUT_KINDS) {
      const marker = parseCalloutMarker(`[!${kind.toUpperCase()}]\nBody`)
      expect(marker).toEqual({ kind, title: '', consumed: kind.length + 4 })
    }
    expect(parseCalloutMarker('[!Tip] body')?.kind).toBe('tip')
  })

  test('keeps the rest of the marker line as the title', () => {
    const text = '[!WARNING] Key rotation\nEvery client logs out.'
    const marker = parseCalloutMarker(text)
    expect(marker?.title).toBe('Key rotation')
    expect(text.slice(marker?.consumed)).toBe('Every client logs out.')
  })

  test('an unknown kind or a marker mid-line is not a callout', () => {
    expect(parseCalloutMarker('[!FOO]\nBody')).toBeNull()
    expect(parseCalloutMarker('See [!NOTE] later')).toBeNull()
    expect(parseCalloutMarker('[NOTE]\nBody')).toBeNull()
  })
})

describe('ATTRIBUTION_PREFIX', () => {
  test('matches an em dash or a double hyphen followed by a space, at the start only', () => {
    expect(ATTRIBUTION_PREFIX.test('— Ada Lovelace')).toBe(true)
    expect(ATTRIBUTION_PREFIX.test('-- Ada Lovelace')).toBe(true)
    expect(ATTRIBUTION_PREFIX.test('—Ada')).toBe(false)
    expect(ATTRIBUTION_PREFIX.test('text — more')).toBe(false)
    expect(ATTRIBUTION_PREFIX.test('- a list item')).toBe(false)
  })
})
