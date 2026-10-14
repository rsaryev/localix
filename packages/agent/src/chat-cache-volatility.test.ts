/**
 * Tests for `detectCacheVolatility`, the always-on guard against a per-turn-volatile
 * token leaking into the provider-cached system-prompt prefix.
 *
 * This detector has two failure directions and both are expensive, which is why the
 * deliberate NON-detections below are pinned as firmly as the detections:
 *
 *   - Missing a volatile token means the prompt cache silently re-writes every turn,
 *     with no error anywhere. That is the regression the guard exists to surface.
 *   - Flagging a stable one means a warning on every production turn of a prompt that
 *     was never broken, which trains readers to ignore the guard entirely.
 *
 * So the rule the detector follows: flag churn it can name with confidence, and stay
 * quiet where a volatile shape is indistinguishable from ordinary static content.
 */
import { describe, expect, it } from 'bun:test'
import { detectCacheVolatility } from './chat-cache'

const kinds = (text: string): string[] => detectCacheVolatility(text).map((f) => f.kind)

describe('detectCacheVolatility — shapes that bust the cache', () => {
  it('flags an ISO timestamp carrying a time component', () => {
    expect(kinds('Session started 2026-07-30T14:05:22')).toContain('timestamp')
    expect(kinds('Session started 2026-07-30 14:05')).toContain('timestamp')
  })

  it('flags a raw epoch-millisecond stamp, the plain shape of Date.now()', () => {
    expect(kinds('Run started at 1772585501101')).toEqual(['epoch'])
  })

  it('flags an epoch stamp embedded in an identifier', () => {
    // The common real shape: a run/session id minted from the clock. A word boundary
    // has to admit this while still rejecting a longer digit run.
    expect(kinds('runId=run-1772585501101')).toEqual(['epoch'])
  })

  it('flags uuids, jwts, and md5/sha1/sha256 digests', () => {
    expect(kinds('run 3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toContain('uuid')
    expect(kinds('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP')).toContain(
      'jwt',
    )
    expect(kinds(`digest ${'0123456789abcdef'.repeat(2)}`)).toContain('hash')
    expect(kinds(`digest ${'0123456789abcdef'.repeat(4)}`)).toContain('hash')
  })

  it('reports findings in document order and honours the cap', () => {
    const text = `later 1772585501101 ... earliest 2026-07-30T14:05:22`
    const indexes = detectCacheVolatility(text).map((f) => f.index)
    expect(indexes).toEqual(indexes.slice().sort((a, b) => a - b))
    expect(detectCacheVolatility(`${text} ${text} ${text}`, { max: 2 })).toHaveLength(2)
  })
})

describe('detectCacheVolatility — deliberate silences', () => {
  it('tolerates a date-only stamp, accepting at most a daily cache roll', () => {
    expect(kinds('Today is 2026-07-30')).toEqual([])
  })

  it('leaves epoch SECONDS alone: 10 digits cannot be told from a large integer', () => {
    // Missing this costs a per-turn cache re-write; flagging it would warn on any
    // ten-digit constant in a prompt that was never volatile. The guard runs on every
    // production turn, so the false positive is the more expensive error here.
    expect(kinds('since 1772585501')).toEqual([])
  })

  it('does not fire inside a longer digit run', () => {
    expect(kinds('checksum 17725855011019999')).toEqual([])
    expect(kinds('count 177258550110')).toEqual([])
  })

  it('does not fire on a 13-digit number outside the epoch range', () => {
    // Opening digit 3 puts it past year 2286 — not a clock value.
    expect(kinds('capacity 3772585501101 bytes')).toEqual([])
  })

  it('stays quiet on ordinary prompt prose', () => {
    expect(kinds('Use the read tool for files under 2000 lines. Prefer 4-space indents.')).toEqual(
      [],
    )
    expect(kinds('')).toEqual([])
  })
})
