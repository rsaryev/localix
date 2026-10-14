import { describe, expect, it } from 'bun:test'
import { capJson } from './history-search-format'

describe('capJson degrades to valid JSON, never a fragment', () => {
  const bigSession = (i: number) => ({
    id: `s${i}`,
    title: 'x'.repeat(2000),
    start: 'a',
    end: 'b',
    matchWindow: 'w',
  })

  it('drops whole trailing sessions and COUNTS them', () => {
    const out = capJson({
      mode: 'discovery',
      sessions: Array.from({ length: 12 }, (_, i) => bigSession(i)),
    })
    const parsed = JSON.parse(out) as {
      sessions: unknown[]
      omittedSessions?: number
      note?: string
    }
    expect(parsed.sessions.length).toBeLessThan(12)
    expect(parsed.omittedSessions).toBe(12 - parsed.sessions.length)
    expect(parsed.note).toContain('omitted')
  })

  it('a single oversized result says so instead of emitting a JSON fragment', () => {
    const out = capJson({ mode: 'discovery', sessions: [{ id: 's0', text: 'x'.repeat(20_000) }] })
    const parsed = JSON.parse(out) as { truncated?: boolean }
    expect(parsed.truncated).toBe(true)
  })

  it('a payload under budget is untouched', () => {
    const out = capJson({ mode: 'discovery', sessions: [{ id: 's0' }] })
    expect(JSON.parse(out)).toEqual({ mode: 'discovery', sessions: [{ id: 's0' }] })
  })
})
