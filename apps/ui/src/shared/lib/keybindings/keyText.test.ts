import { describe, expect, test } from 'bun:test'

import { isNonTextWritingKey } from './keyText'

const plain = (key: string) => ({ key, metaKey: false, ctrlKey: false, altKey: false })

describe('isNonTextWritingKey', () => {
  test.each(['a', 'Z', '1', '/', ' ', 'é', 'ß'])('%s writes text', (key) => {
    expect(isNonTextWritingKey(plain(key))).toBe(false)
  })

  test.each(['Enter', 'Escape', 'Tab', 'Backspace', 'ArrowLeft', 'F1', 'F12', 'Home'])(
    '%s does not write text',
    (key) => {
      expect(isNonTextWritingKey(plain(key))).toBe(true)
    },
  )

  test('a command modifier makes any key non-writing', () => {
    expect(isNonTextWritingKey({ key: 'a', metaKey: true, ctrlKey: false, altKey: false })).toBe(
      true,
    )
    expect(isNonTextWritingKey({ key: 'a', metaKey: false, ctrlKey: true, altKey: false })).toBe(
      true,
    )
    expect(isNonTextWritingKey({ key: 'a', metaKey: false, ctrlKey: false, altKey: true })).toBe(
      true,
    )
  })

  test('Shift alone still types — it is how capitals are written', () => {
    expect(isNonTextWritingKey(plain('A'))).toBe(false)
  })

  test('an emoji is one character even though it is several code units', () => {
    expect(isNonTextWritingKey(plain('😀'))).toBe(false)
  })
})
