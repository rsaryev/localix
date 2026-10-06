import { describe, expect, test } from 'bun:test'
import { nativeInputOwnsKey } from './nativeInputKeys'

const key = (key: string, modifiers = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
})

describe('native field key ownership', () => {
  test('typing, selection, clipboard, undo and caret keys survive workspace overrides on every OS', () => {
    for (const os of ['mac', 'windows', 'linux'] as const) {
      const mod = os === 'mac' ? { metaKey: true } : { ctrlKey: true }
      for (const value of ['k', 'Enter', 'Tab', 'Delete', 'ArrowDown'])
        expect(nativeInputOwnsKey(key(value), false, os)).toBe(true)
      for (const value of ['a', 'c', 'v', 'x', 'z', 'y']) {
        expect(nativeInputOwnsKey(key(value, mod), false, os)).toBe(true)
        expect(nativeInputOwnsKey(key(value, { ...mod, shiftKey: true }), false, os)).toBe(true)
      }
      expect(nativeInputOwnsKey(key('ArrowLeft', { altKey: true }), false, os)).toBe(true)
      expect(nativeInputOwnsKey(key('Backspace', mod), false, os)).toBe(true)
    }
  })

  test('rich text retains formatting while plain fields still allow workspace chords', () => {
    for (const value of ['b', 'i', 'u']) {
      expect(nativeInputOwnsKey(key(value, { metaKey: true }), true, 'mac')).toBe(true)
      expect(nativeInputOwnsKey(key(value, { metaKey: true }), false, 'mac')).toBe(false)
    }
    expect(nativeInputOwnsKey(key('≈', { altKey: true }), false, 'mac')).toBe(true)
    expect(nativeInputOwnsKey(key('k', { ctrlKey: true }), false, 'mac')).toBe(true)
    expect(nativeInputOwnsKey(key('k', { metaKey: true }), false, 'mac')).toBe(false)
  })

  test('Escape, function keys and unclaimed commands remain available', () => {
    for (const value of ['Escape', 'F1', 'F6'])
      expect(nativeInputOwnsKey(key(value), false, 'mac')).toBe(false)
    expect(nativeInputOwnsKey(key('p', { metaKey: true, shiftKey: true }), false, 'mac')).toBe(
      false,
    )
    expect(nativeInputOwnsKey(key('f', { ctrlKey: true }), false, 'windows')).toBe(false)
  })
})
