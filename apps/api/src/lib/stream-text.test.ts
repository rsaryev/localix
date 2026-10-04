import { describe, expect, test } from 'bun:test'

import { createStreamTextDecoder } from './stream-text'

/** Split `text`'s UTF-8 bytes at `cut` and feed both halves through `decode`. */
function feedSplit(text: string, cut: number, decode: (chunk: Uint8Array) => string): string {
  const bytes = new TextEncoder().encode(text)
  return decode(bytes.slice(0, cut)) + decode(bytes.slice(cut))
}

describe('createStreamTextDecoder', () => {
  test('reassembles a character split across two chunks, at every byte offset', () => {
    // A menu frame as a coding-agent TUI paints it: box drawing (3 bytes each),
    // accented Latin (2), an emoji (4). Every interior cut lands inside some character.
    const frame = '┌─────┐ café naïve 🎉'
    const byteLength = new TextEncoder().encode(frame).length

    for (let cut = 1; cut < byteLength; cut++) {
      expect(feedSplit(frame, cut, createStreamTextDecoder())).toBe(frame)
    }
  })

  test('a fresh decode per chunk is what corrupts it — the behaviour being replaced', () => {
    const frame = '┌─────┐'
    // Cut inside the second box-drawing character.
    const naive = feedSplit(frame, 4, (chunk) => new TextDecoder().decode(chunk))

    expect(naive).not.toBe(frame)
    expect(naive).toContain('�')
  })

  test('plain ASCII is unaffected', () => {
    const decode = createStreamTextDecoder()
    expect(decode(new TextEncoder().encode('$ ls -la'))).toBe('$ ls -la')
  })

  test('a chunk that ends on a character boundary emits immediately', () => {
    const decode = createStreamTextDecoder()
    // Nothing may be held back here — a terminal frame must not wait for the next
    // read to become visible.
    expect(decode(new TextEncoder().encode('┌'))).toBe('┌')
    expect(decode(new TextEncoder().encode('┐'))).toBe('┐')
  })

  test('each stream needs its own decoder — state must not leak between them', () => {
    const bytes = new TextEncoder().encode('┌')
    const a = createStreamTextDecoder()
    const b = createStreamTextDecoder()

    // Half a character into A; B must be unaffected by A's pending bytes.
    expect(a(bytes.slice(0, 2))).toBe('')
    expect(b(new TextEncoder().encode('x'))).toBe('x')
    expect(a(bytes.slice(2))).toBe('┌')
  })
})
