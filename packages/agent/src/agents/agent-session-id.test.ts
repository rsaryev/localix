import { describe, it, expect } from 'bun:test'

import { isValidAgentSessionId } from './agent-session-id'

describe('isValidAgentSessionId', () => {
  it('accepts real-world session id shapes', () => {
    expect(isValidAgentSessionId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true) // uuid
    expect(isValidAgentSessionId('sess_01HXYZABC123')).toBe(true)
    expect(isValidAgentSessionId('codex:thread.2026-06-28T10:00:00')).toBe(true)
  })

  it('rejects ids that would be parsed as a flag', () => {
    expect(isValidAgentSessionId('-p')).toBe(false)
    expect(isValidAgentSessionId('--dangerously-skip-permissions')).toBe(false)
    expect(isValidAgentSessionId('-')).toBe(false)
  })

  it('rejects whitespace and control characters', () => {
    expect(isValidAgentSessionId('abc def')).toBe(false)
    expect(isValidAgentSessionId('abc\tdef')).toBe(false)
    expect(isValidAgentSessionId('abc\ndef')).toBe(false)
    // NUL must stay ESCAPED. A raw \x00 byte in the source makes ripgrep classify this
    // file as binary: a recursive `rg` then silently reports NOTHING past the byte (no
    // warning, exit 1), so everything below this line drops out of every repo-wide
    // audit while the lines above still match — the file looks searched when it is not.
    expect(isValidAgentSessionId('abc\x00def')).toBe(false)
  })

  it('rejects empty, oversized, and non-string input', () => {
    expect(isValidAgentSessionId('')).toBe(false)
    expect(isValidAgentSessionId('a'.repeat(513))).toBe(false)
    expect(isValidAgentSessionId(undefined)).toBe(false)
    expect(isValidAgentSessionId(null)).toBe(false)
    expect(isValidAgentSessionId(123)).toBe(false)
  })

  it('accepts the max length boundary', () => {
    expect(isValidAgentSessionId('a'.repeat(512))).toBe(true)
  })
})
