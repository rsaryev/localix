import { describe, expect, test } from 'bun:test'
import { cleanSystemMessageText } from './systemMessageText'

describe('cleanSystemMessageText', () => {
  test('removes decorative status emoji from legacy system output', () => {
    expect(cleanSystemMessageText('✅ Installed `review`.\n  ⚠ Warning')).toBe(
      'Installed `review`.\n  Warning',
    )
  })

  test('preserves words, markdown, and line breaks', () => {
    expect(cleanSystemMessageText('Installed `review`.\nStart a new turn.')).toBe(
      'Installed `review`.\nStart a new turn.',
    )
  })
})
