import { expect, test } from 'bun:test'
import { chordFromEvent, matchesChord } from './chord'

const optionX = {
  key: '≈',
  code: 'KeyX',
  metaKey: false,
  ctrlKey: false,
  altKey: true,
  shiftKey: false,
}

test('macOS Option-letter shortcuts match and record their physical letter equivalent', () => {
  expect(matchesChord(optionX, 'alt+x', 'mac')).toBe(true)
  expect(chordFromEvent(optionX, 'mac')).toBe('alt+x')
  expect(matchesChord(optionX, 'alt+≈', 'mac')).toBe(true)
  expect(matchesChord(optionX, 'x', 'mac')).toBe(false)
  expect(matchesChord(optionX, 'alt+x', 'windows')).toBe(false)
  expect(matchesChord(optionX, 'alt+x', 'linux')).toBe(false)
})

test('Option normalization preserves normal layout letters and unmodified text', () => {
  expect(matchesChord({ ...optionX, key: 'y' }, 'alt+x', 'mac')).toBe(false)
  expect(chordFromEvent({ ...optionX, key: 'y' }, 'mac')).toBe('alt+y')
  expect(chordFromEvent({ ...optionX, altKey: false }, 'mac')).toBe('≈')
  expect(matchesChord({ ...optionX, code: undefined }, 'alt+x', 'mac')).toBe(false)
})
