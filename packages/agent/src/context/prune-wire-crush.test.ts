/**
 * GP-1 integration: prune-wire bounds OLD large non-recoverable (bash) output with a
 * STRUCTURAL crush (JSON array / log) when one applies, instead of blind head+tail
 * truncation — keeping more signal per token. Must stay idempotent.
 */
import { describe, it, expect } from 'bun:test'
import type { Message } from '../types'
import { pruneWireMessages } from './prune-wire'
import { CRUSH_MARKER } from './crushers'

const MIDDLE_MARKER = '[…middle truncated to save context'

// Place a big bash result early, then enough trailing messages that it falls OUTSIDE
// the protected recent window (first message + last `minKeepRecent`).
function wireWith(bashContent: string): Message[] {
  const msgs: Message[] = [{ role: 'user', content: 'do it', timestamp: 0 }]
  msgs.push({
    role: 'assistant',
    content: [{ type: 'tool_call', id: 'b1', name: 'Bash', arguments: { command: 'run' } }],
    model: 'm',
    timestamp: 0,
  })
  msgs.push({
    role: 'tool',
    results: [{ type: 'tool_result', toolCallId: 'b1', toolName: 'Bash', content: bashContent }],
    timestamp: 0,
  })
  for (let i = 0; i < 6; i++) {
    msgs.push({ role: 'user', content: `follow-up ${i}`, timestamp: 0 })
    msgs.push({
      role: 'assistant',
      content: [{ type: 'text', text: `reply ${i}` }],
      model: 'm',
      timestamp: 0,
    })
  }
  return msgs
}

const bashContent = (m: Message): string => {
  const r = m.role === 'tool' ? m.results[0] : undefined
  return r && typeof r.content === 'string' ? r.content : ''
}

describe('prune-wire structural crush of old bash output', () => {
  it('crushes a large JSON-array bash result (smaller than head/tail truncation)', () => {
    const json = JSON.stringify(
      Array.from({ length: 120 }, (_, i) => ({
        host: 'prod-1',
        svc: 'api',
        ts: 1700000000 + i,
        cpu: 40 + (i % 9),
      })),
    )
    const out = pruneWireMessages(wireWith(json), { keepRecentTokens: 100 })
    const crushed = bashContent(out[2])
    expect(crushed).toContain(CRUSH_MARKER)
    expect(crushed).toContain('__constants') // JSON crusher hoisted shared fields
    expect(crushed.length).toBeLessThan(json.length * 0.5)
  })

  it('crushes a large log bash result, preserving the error + verdict', () => {
    const log = [
      '$ npm test',
      ...Array.from(
        { length: 300 },
        (_, i) => `  ✓ ok case ${i} passed in ${i % 50}ms (suite/group/file-${i}.spec.ts)`,
      ),
      '  ✗ case 91 failed: timeout',
      '    at run (test/x.spec.ts:9:1)',
      'Tests: 1 failed, 90 passed',
    ].join('\n')
    const out = pruneWireMessages(wireWith(log), { keepRecentTokens: 100 })
    const crushed = bashContent(out[2])
    expect(crushed).toContain(CRUSH_MARKER)
    expect(crushed).toContain('case 91 failed: timeout')
    expect(crushed).toContain('Tests: 1 failed, 90 passed')
    expect(crushed).not.toContain('ok case 45')
  })

  it('is idempotent: a second pass does not re-crush', () => {
    const json = JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ host: 'prod-1', cpu: i })))
    const once = pruneWireMessages(wireWith(json), { keepRecentTokens: 100 })
    const twice = pruneWireMessages(once, { keepRecentTokens: 100 })
    expect(bashContent(twice[2])).toBe(bashContent(once[2]))
  })

  it('falls back to head/tail truncation when no crusher applies (single huge line)', () => {
    const blob = 'x'.repeat(9000) // not JSON, one line → neither crusher applies
    const out = pruneWireMessages(wireWith(blob), { keepRecentTokens: 100 })
    const bounded = bashContent(out[2])
    expect(bounded).toContain(MIDDLE_MARKER)
    expect(bounded).not.toContain(CRUSH_MARKER)
    // The truncate path advertises recovery too — so the model retrieves the full
    // original instead of re-running the command for a dropped middle line.
    expect(bounded).toContain('ToolOutput(action="get", tool_call_id="b1")')
  })
})
