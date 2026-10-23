import { describe, expect, test } from 'bun:test'

import type { SessionLoop } from './contracts'
import { resolveLoopId } from './resolve-id'

function loop(id: string, over: Partial<SessionLoop> = {}): SessionLoop {
  return {
    id,
    userId: 'u',
    sessionId: 's',
    kind: 'fixed',
    cron: '*/5 * * * *',
    prompt: 'check deploy',
    maintenance: false,
    createdAt: '2026-06-16T10:00:00.000Z',
    nextRunAt: '2026-06-16T10:05:00.000Z',
    target: 'session',
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    ...over,
  }
}

describe('resolveLoopId', () => {
  const a = loop('abcdef01-1111-4111-8111-000000000001')
  const b = loop('abcdef02-2222-4222-8222-000000000002')
  const other = loop('ffffffff-9999-4999-8999-000000000009')

  test('exact full id wins', () => {
    const res = resolveLoopId(a.id, [a, b])
    expect(res.kind).toBe('match')
    expect(res.kind === 'match' && res.loop.id).toBe(a.id)
  })

  test('exact match wins even below the prefix floor (would-be ambiguous prefix)', () => {
    // Two loops share the "abcdef0" prefix; the full id still resolves cleanly.
    const res = resolveLoopId(b.id, [a, b])
    expect(res.kind).toBe('match')
    expect(res.kind === 'match' && res.loop.id).toBe(b.id)
  })

  test('unique case-insensitive prefix resolves', () => {
    const res = resolveLoopId('ABCDEF01', [a, b])
    expect(res.kind).toBe('match')
    expect(res.kind === 'match' && res.loop.id).toBe(a.id)
  })

  test('8-char short id (as shown by /loop list) resolves', () => {
    const res = resolveLoopId(a.id.slice(0, 8), [a, b])
    expect(res.kind).toBe('match')
    expect(res.kind === 'match' && res.loop.id).toBe(a.id)
  })

  test('ambiguous prefix reports all candidates', () => {
    const res = resolveLoopId('abcdef', [a, b])
    expect(res.kind).toBe('ambiguous')
    expect(res.kind === 'ambiguous' && res.candidates.map((l) => l.id).sort()).toEqual(
      [a.id, b.id].sort(),
    )
  })

  test('too-short prefix does not resolve', () => {
    expect(resolveLoopId('abc', [a, b]).kind).toBe('none')
    // A 5-char prefix is one short of the floor.
    expect(resolveLoopId('abcde', [a, b]).kind).toBe('none')
  })

  test('a loop outside the provided owned set is not resolvable', () => {
    // Caller scopes ownedLoops to this session; `other` is simply absent.
    expect(resolveLoopId(other.id, [a, b]).kind).toBe('none')
    expect(resolveLoopId('ffffffff', [a, b]).kind).toBe('none')
  })

  test('unknown but long-enough prefix resolves to none', () => {
    expect(resolveLoopId('zzzzzz', [a, b]).kind).toBe('none')
  })

  test('blank id resolves to none', () => {
    expect(resolveLoopId('   ', [a, b]).kind).toBe('none')
  })
})
