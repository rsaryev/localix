/**
 * `readBodyCapped`'s charset handling.
 *
 * These live HERE rather than in a caller because that is where the defensive branch is reachable.
 * A sabotage run proved the point: deleting `decoderFor`'s try/catch — so an unsupported label
 * throws `RangeError` instead of falling back — was not caught by downstream caller tests because
 * their inputs were already normalized. But `readBodyCapped` is shared by four callers, and the
 * next one to pass a charset straight off a `Content-Type` header would turn a garbled body into a
 * failed request. An untested guard on a shared function is a guard for exactly nobody.
 */

import { describe, expect, test } from 'bun:test'
import { readBodyCapped } from '@localixai/mini-app-sdk/backend'

const body = (bytes: number[], streamed = true) =>
  streamed
    ? new Response(new Uint8Array(bytes))
    : ({ body: null, text: async () => Buffer.from(bytes).toString('utf8') } as never)

describe('readBodyCapped decodes with the charset it is given', () => {
  test('no charset is UTF-8 — the behaviour every existing caller relies on', async () => {
    const bytes = [...new TextEncoder().encode('こんにちは')]
    expect((await readBodyCapped(body(bytes), 1000)).text).toBe('こんにちは')
  })

  test.each([
    ['iso-8859-1', [0x63, 0x61, 0x66, 0xe9], 'café'],
    ['shift_jis', [0x82, 0xb1, 0x82, 0xf1], 'こん'],
  ])('%p is honoured', async (charset, bytes, expected) => {
    expect((await readBodyCapped(body(bytes), 1000, charset)).text).toBe(expected)
  })
})

describe('an unsupported label falls back to UTF-8 rather than throwing', () => {
  // `new TextDecoder('windows-1251')` raises RangeError in this runtime. A garbled body is bad; a
  // failed request because the SERVER named a charset we do not know is worse.
  test.each(['windows-1251', 'koi8-r', 'not-a-charset', 'x'])(
    '%p does not throw',
    async (charset) => {
      const out = await readBodyCapped(body([0x61, 0x62]), 1000, charset)
      expect(out.text).toBe('ab')
    },
  )

  test('and the bytes still arrive, mis-decoded but present', async () => {
    // The caller decides whether to warn — this function's only job is to not explode.
    const out = await readBodyCapped(body([0xcf, 0xf0, 0xe8]), 1000, 'windows-1251')
    expect(out.bytes).toBe(3)
    expect(out.text.length).toBeGreaterThan(0)
  })
})

describe('the cap still applies, whatever the charset', () => {
  test('a body over maxBytes is truncated and says so', async () => {
    const out = await readBodyCapped(
      body([...new TextEncoder().encode('abcdefghij')]),
      4,
      'iso-8859-1',
    )
    expect(out.truncated).toBe(true)
    expect(out.bytes).toBe(4)
  })
})
