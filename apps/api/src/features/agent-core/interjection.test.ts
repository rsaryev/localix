import { describe, expect, it } from 'bun:test'

import {
  MAX_INTERJECTION_CHARS,
  frameDelegatorMessage,
  frameInterjection,
  midRunInterjectEnabled,
  truncateOnCodePointBoundary,
} from './interjection'

describe('midRunInterjectEnabled', () => {
  it('defaults ON when the variable is unset', () => {
    expect(midRunInterjectEnabled({})).toBe(true)
  })

  it('blank means unset (still ON)', () => {
    expect(midRunInterjectEnabled({ LOCALIX_MID_RUN_INTERJECT: '  ' })).toBe(true)
  })

  it('kill switch: LOCALIX_MID_RUN_INTERJECT=0 disables', () => {
    expect(midRunInterjectEnabled({ LOCALIX_MID_RUN_INTERJECT: '0' })).toBe(false)
    expect(midRunInterjectEnabled({ LOCALIX_MID_RUN_INTERJECT: 'false' })).toBe(false)
  })

  it('explicit 1 stays ON', () => {
    expect(midRunInterjectEnabled({ LOCALIX_MID_RUN_INTERJECT: '1' })).toBe(true)
  })
})

describe('truncateOnCodePointBoundary', () => {
  it('passes short text through untouched', () => {
    expect(truncateOnCodePointBoundary('hello', 10)).toEqual({ text: 'hello', truncated: false })
  })

  it('text exactly at the cap is not truncated', () => {
    const text = 'a'.repeat(10)
    expect(truncateOnCodePointBoundary(text, 10)).toEqual({ text, truncated: false })
  })

  it('cuts at the cap', () => {
    const { text, truncated } = truncateOnCodePointBoundary('a'.repeat(11), 10)
    expect(truncated).toBe(true)
    expect(text).toBe('a'.repeat(10))
  })

  it('never splits a surrogate pair (UTF-8-safe boundary)', () => {
    // 9 ASCII chars + an emoji (2 UTF-16 units) straddling the cap at 10:
    // a naive slice(0, 10) would keep a lone high surrogate.
    const input = 'a'.repeat(9) + '\u{1F600}'
    const { text, truncated } = truncateOnCodePointBoundary(input, 10)
    expect(truncated).toBe(true)
    expect(text).toBe('a'.repeat(9))
    // The result round-trips through UTF-8 without replacement characters.
    expect(new TextDecoder().decode(new TextEncoder().encode(text))).toBe(text)
  })
})

describe('frameInterjection', () => {
  it('wraps the raw content in the interjection envelope', () => {
    expect(frameInterjection('fix the tests first')).toBe(
      'The user sent a message while you were working:\n<user_query>fix the tests first</user_query>',
    )
  })

  it('keeps a message at the cap intact (no notice)', () => {
    const content = 'x'.repeat(MAX_INTERJECTION_CHARS)
    const framed = frameInterjection(content)
    expect(framed).toContain(content)
    expect(framed).not.toContain('truncated')
  })

  it('truncates an oversized message and appends a notice inside the envelope', () => {
    const framed = frameInterjection('y'.repeat(MAX_INTERJECTION_CHARS + 500))
    expect(framed).toContain('y'.repeat(MAX_INTERJECTION_CHARS))
    expect(framed).not.toContain('y'.repeat(MAX_INTERJECTION_CHARS + 1))
    expect(framed).toContain(
      `[... message truncated: it exceeded ${MAX_INTERJECTION_CHARS} characters`,
    )
    expect(framed.endsWith('</user_query>')).toBe(true)
  })
})

describe('frameDelegatorMessage', () => {
  it('is an amendment from whoever wrote the brief — not the user, not untrusted data', () => {
    // Framed as data, "stop, the endpoint moved" is read and politely ignored.
    const framed = frameDelegatorMessage('The endpoint moved to /v2.')
    expect(framed).toContain('<delegator_message>The endpoint moved to /v2.</delegator_message>')
    expect(framed).toContain('update to your assignment')
    expect(framed).toContain('supersedes conflicting earlier directions')
    expect(framed).toContain('keep requirements it does not change')
    expect(framed).not.toContain('The user sent')
    expect(framed).not.toContain('untrusted')
  })

  it('is bounded like any interjection', () => {
    const framed = frameDelegatorMessage('x'.repeat(MAX_INTERJECTION_CHARS + 10))
    expect(framed).toContain('message truncated')
    expect(framed).not.toContain('x'.repeat(MAX_INTERJECTION_CHARS + 1))
  })
})
