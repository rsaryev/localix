import { describe, it, expect } from 'bun:test'
import {
  buildSessionDigest,
  DIGEST_MAX_TURNS,
  DIGEST_PER_TURN_CHARS,
  type SessionDigestInput,
} from './session-digest'

const base: SessionDigestInput = {
  id: 'LOCALIX-42',
  title: 'Fix login bug',
  runtimeStatus: 'idle',
  messageCount: 12,
  updatedAt: '2026-07-03T10:00:00.000Z',
  recentTurns: [],
}

describe('buildSessionDigest', () => {
  it('renders a header with title, status and date', () => {
    const out = buildSessionDigest(base)
    expect(out).toContain('Session LOCALIX-42 — "Fix login bug"')
    expect(out).toContain('Status: idle · 12 messages · updated 2026-07-03')
  })

  it('always points the agent at history_search for deeper reads', () => {
    expect(buildSessionDigest(base)).toContain('history_search')
    expect(buildSessionDigest(base)).toContain('sessionId "LOCALIX-42"')
  })

  it('keeps only the last N turns, oldest→newest', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ role: 'user', text: `turn ${i}` }))
    const out = buildSessionDigest({ ...base, recentTurns: turns })
    expect(out).toContain(`Recent turns (last ${DIGEST_MAX_TURNS}):`)
    expect(out).toContain('turn 9')
    expect(out).not.toContain('turn 3') // dropped: only the last 6 survive
  })

  it('trims a very long turn and collapses whitespace', () => {
    const long = 'x'.repeat(DIGEST_PER_TURN_CHARS + 500)
    const out = buildSessionDigest({
      ...base,
      recentTurns: [{ role: 'assistant', text: `a\n\n b   ${long}` }],
    })
    expect(out).toContain('[assistant] a b')
    expect(out).toContain('…')
    // Overall size stays economical — low thousands of chars, not a full transcript.
    expect(out.length).toBeLessThan(DIGEST_PER_TURN_CHARS + 600)
  })

  it('empty session (no summary or turns) still renders a valid digest', () => {
    const out = buildSessionDigest({ ...base, messageCount: 0 })
    expect(out).toContain('(No conversation content yet.)')
    expect(out).toContain('history_search')
  })
})
