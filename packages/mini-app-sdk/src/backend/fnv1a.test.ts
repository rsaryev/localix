import { describe, expect, test } from 'bun:test'

import { fnv1a32, fnv1aHex } from './fnv1a'

/** The loop the three callers open-coded, verbatim — the baseline this must reproduce. */
function openCoded(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16)
}

describe('fnv1a', () => {
  test('reproduces the open-coded loop byte-for-byte (so no revision string churns)', () => {
    const inputs = [
      '',
      'a',
      'hello world',
      'db-auto:some-table\nother-table',
      'chat\nid:1::content',
      'x'.repeat(5000),
      'unicode — ünïcödé ✓ 🎉',
      'a\nb\nc',
    ]
    for (const input of inputs) {
      expect(fnv1aHex(input)).toBe(openCoded(input))
    }
  })

  test('known FNV-1a 32 vectors', () => {
    // The canonical reference digests for the FNV-1a 32-bit function.
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1aHex('a')).toBe('e40c292c')
    expect(fnv1aHex('foobar')).toBe('bf9cf968')
  })

  test('different content → different digest; same content → same digest', () => {
    expect(fnv1aHex('one')).not.toBe(fnv1aHex('two'))
    expect(fnv1aHex('same')).toBe(fnv1aHex('same'))
  })
})
