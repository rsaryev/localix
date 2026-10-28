/**
 * Elision must be MONOTONE: a tool result this session already sent as a pointer is never
 * sent back intact.
 *
 * It could come back. The protected tail is TOKEN-capped, so when the turn-start VBC pass
 * shrinks the messages behind a result, the tail stretches further back in message COUNT and
 * swallows a message the previous request had pointered. Offline simulation counts that
 * as `reinfl` — 120 of them on the coding profile at a 128k window, each one rewriting the
 * cached prefix from that position on, to hand the model bytes it had already read a pointer
 * for and moved past.
 *
 * The ratchet is the wire layer's `opFloor`: the same never-re-inflate guarantee the VBC
 * allocator has one layer up.
 */
import { describe, expect, test } from 'bun:test'
import {
  collectElidedArgToolCallIds,
  collectElidedToolCallIds,
  pruneWireMessages,
} from './prune-wire'
import type { Message } from '../types'

const big = (n: number) => 'x'.repeat(n)

const readCall = (id: string, path: string): Message => ({
  role: 'assistant',
  model: 'm',
  timestamp: 0,
  content: [{ type: 'tool_call', id, name: 'Read', arguments: { path } }],
})

const readResult = (id: string, chars = 4000): Message => ({
  role: 'tool',
  timestamp: 0,
  results: [{ type: 'tool_result', toolCallId: id, toolName: 'Read', content: big(chars) }],
})

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 })

/** A history whose read at `A` sits far enough back to be pruned. */
function history(pairs: number): Message[] {
  const out: Message[] = [user('task')]
  for (let i = 0; i < pairs; i++) {
    out.push(readCall(`t-${i}`, `/repo/f-${i}.ts`), readResult(`t-${i}`))
  }
  return out
}

const contentOf = (msgs: Message[], id: string): string => {
  for (const m of msgs) {
    if (m.role !== 'tool') continue
    for (const r of m.results)
      if (r.toolCallId === id && typeof r.content === 'string') return r.content
  }
  throw new Error(`no result ${id}`)
}

// ~1030 tokens per read result, so the tail covers the last four of them.
const OPTS = {
  keepRecentTokens: 4200,
  minKeepRecent: 2,
  boundaryQuantum: 1,
  maxLiveReads: 0,
} as const

describe('the wire prune ratchets: an elided result never re-inflates', () => {
  test('without the ratchet, a shorter history hands the result straight back', () => {
    const long = history(12)
    const prunedLong = pruneWireMessages(long, OPTS)
    expect(contentOf(prunedLong, 't-0')).toContain('elided to save context')

    // Exactly what VBC does between runs: the messages BEHIND t-0's result shrink, so the
    // token-capped tail now reaches back over it.
    const short = [long[0], long[1], long[2], ...long.slice(-4)]
    const prunedShort = pruneWireMessages(short, OPTS)
    expect(contentOf(prunedShort, 't-0')).toBe(big(4000)) // ← the re-inflation
  })

  test('with the ratchet, the same result stays a pointer', () => {
    const long = history(12)
    const seen = new Set(collectElidedToolCallIds(pruneWireMessages(long, OPTS)))
    expect(seen.has('t-0')).toBe(true)

    const short = [long[0], long[1], long[2], ...long.slice(-4)]
    const prunedShort = pruneWireMessages(short, { ...OPTS, elidedToolCallIds: seen })
    expect(contentOf(prunedShort, 't-0')).toContain('elided to save context')
  })

  test('it only touches ratcheted ids — the rest of the tail is still verbatim', () => {
    const long = history(12)
    const seen = new Set(['t-0'])
    const pruned = pruneWireMessages(long, { ...OPTS, elidedToolCallIds: seen })
    // The newest read is in the tail and was never elided → untouched.
    expect(contentOf(pruned, 't-11')).toBe(big(4000))
  })

  test('a ratcheted read loses the live-read protection it already lost', () => {
    // `t-0` is the only copy of f-0.ts, so `maxLiveReads` normally keeps it whole even out
    // here past the tail. But we already sent it as a pointer: protecting it now would
    // re-inflate it, and its `ToolOutput` handle is what recovers the bytes.
    const msgs = history(5)
    const opts = { ...OPTS, maxLiveReads: 6, liveReadBudgetBytes: 100_000 }
    expect(contentOf(pruneWireMessages(msgs, opts), 't-0')).toBe(big(4000))
    const ratcheted = pruneWireMessages(msgs, { ...opts, elidedToolCallIds: new Set(['t-0']) })
    expect(contentOf(ratcheted, 't-0')).toContain('elided to save context')
  })

  test('an unknown id in the set changes nothing (a compaction leaves stale ids behind)', () => {
    // Short enough that nothing is prunable at all: the identity return must survive a
    // non-empty ratchet, or every request past a compaction rewrites the whole array.
    const msgs = history(3)
    expect(pruneWireMessages(msgs, OPTS)).toBe(msgs)
    expect(
      pruneWireMessages(msgs, { ...OPTS, elidedToolCallIds: new Set(['gone', 'also-gone']) }),
    ).toBe(msgs)
  })

  test('the pressure gate says "no NEW compression", not "give it all back"', () => {
    // Both early returns used to hand `messages` straight back. After a compaction (or once
    // VBC shrinks the history behind it) the request drops under the gate again — and every
    // pointer the session had already sent turned back into full bytes.
    const msgs = history(12)
    const seen = new Set(['t-0'])
    const gated = { ...OPTS, pressureTokens: 10_000_000, elidedToolCallIds: seen }
    expect(contentOf(pruneWireMessages(msgs, gated), 't-0')).toContain('elided to save context')
    expect(contentOf(pruneWireMessages(msgs, gated), 't-5')).toBe(big(4000)) // nothing NEW elided
  })

  test('the reclaim floor is ratcheted too', () => {
    const msgs = history(12)
    const seen = new Set(['t-0'])
    const floored = { ...OPTS, minReclaimTokens: 10_000_000, elidedToolCallIds: seen }
    expect(contentOf(pruneWireMessages(msgs, floored), 't-0')).toContain('elided to save context')
    expect(contentOf(pruneWireMessages(msgs, floored), 't-5')).toBe(big(4000))
  })

  test('an empty ratchet leaves both early returns a scan-free identity', () => {
    const msgs = history(12)
    expect(pruneWireMessages(msgs, { ...OPTS, pressureTokens: 10_000_000 })).toBe(msgs)
    expect(pruneWireMessages(msgs, { ...OPTS, minReclaimTokens: 10_000_000 })).toBe(msgs)
  })

  test('applying it twice is a fixpoint', () => {
    const msgs = history(12)
    const seen = new Set(['t-0', 't-1'])
    const once = pruneWireMessages(msgs, { ...OPTS, elidedToolCallIds: seen })
    const twice = pruneWireMessages(once, { ...OPTS, elidedToolCallIds: seen })
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })
})

describe('the ARG half: elided write/patch args never re-inflate either', () => {
  const writeCall = (id: string, path: string, chars = 4000): Message => ({
    role: 'assistant',
    model: 'm',
    timestamp: 0,
    content: [{ type: 'tool_call', id, name: 'Write', arguments: { path, content: big(chars) } }],
  })
  const writeResult = (id: string): Message => ({
    role: 'tool',
    timestamp: 0,
    results: [
      { type: 'tool_result', toolCallId: id, toolName: 'Write', content: 'Wrote 4000 bytes' },
    ],
  })
  const argOf = (msgs: Message[], id: string): string => {
    for (const m of msgs) {
      if (m.role !== 'assistant') continue
      for (const part of m.content) {
        const tc = part as { type: string; id: string; arguments?: { content?: string } }
        if (tc.type === 'tool_call' && tc.id === id) return String(tc.arguments?.content)
      }
    }
    throw new Error(`no call ${id}`)
  }
  const writeHistory = (pairs: number): Message[] => {
    const out: Message[] = [user('task')]
    for (let i = 0; i < pairs; i++)
      out.push(writeCall(`w-${i}`, `/repo/f-${i}.ts`), writeResult(`w-${i}`))
    return out
  }

  test('without it, a shorter history re-inflates the write content', () => {
    const long = writeHistory(12)
    const argIds = new Set(collectElidedArgToolCallIds(pruneWireMessages(long, OPTS)))
    expect(argIds.has('w-0')).toBe(true)

    const short = [long[0], long[1], long[2], ...long.slice(-4)]
    expect(argOf(pruneWireMessages(short, OPTS), 'w-0')).toBe(big(4000)) // the re-inflation
    const ratcheted = pruneWireMessages(short, { ...OPTS, elidedArgToolCallIds: argIds })
    expect(argOf(ratcheted, 'w-0')).toContain('elided to save context')
  })

  test('the RESULT set does not leak into args and vice versa', () => {
    const long = writeHistory(12)
    const short = [long[0], long[1], long[2], ...long.slice(-4)]
    // result-ratcheting w-0 must not touch its (re-inflated) args
    const viaResultSet = pruneWireMessages(short, { ...OPTS, elidedToolCallIds: new Set(['w-0']) })
    expect(argOf(viaResultSet, 'w-0')).toBe(big(4000))
  })

  test('a FAILED mutation is exempt even when ratcheted — its args are the only copy', () => {
    // The failed-call rule outranks the ratchet: elideToolCallArgs refuses failed
    // calls, so a ratcheted id whose result later errored keeps its args verbatim.
    const msgs: Message[] = [
      user('task'),
      writeCall('w-f', '/repo/f.ts'),
      {
        role: 'tool',
        timestamp: 0,
        results: [
          {
            type: 'tool_result',
            toolCallId: 'w-f',
            toolName: 'Write',
            content: 'EACCES',
            isError: true,
          },
        ],
      },
      ...Array.from({ length: 6 }, (_, i) => user(`filler ${i}`)),
    ]
    const out = pruneWireMessages(msgs, { ...OPTS, elidedArgToolCallIds: new Set(['w-f']) })
    expect(argOf(out, 'w-f')).toBe(big(4000))
  })
})
