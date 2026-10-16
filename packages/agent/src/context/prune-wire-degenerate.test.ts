/**
 * DEGENERATE-INPUT tests for `pruneWireMessages`' live-read protection.
 *
 * The live-read protection is what keeps the model's ONLY copy of a file on the wire.
 * Every protective mechanism has a zero (absent / 0 / negative / NaN), and the only
 * question that matters is which way it fails on that zero. Safety must fail CLOSED.
 *
 * It did not. `liveReadBudgetBytes` defaulted to `4 × keepRecentTokens`, so a caller
 * passing the perfectly legal `keepRecentTokens: 0` got a budget of 0 — and a budget of
 * 0 meant "protect nothing". The protection switched itself off, silently, by arithmetic,
 * on an input nobody would think to question. (`prune-wire-boundaries.test.ts` had to pin
 * the budget by hand to stop it masking every live-read threshold in that file.)
 *
 * The shape rule these tests pin:
 *   - `liveReadBudgetBytes` is a BUDGET, never a switch. Non-positive / non-finite → the
 *     safe default. It cannot turn the protection off.
 *   - `maxLiveReads: 0` is the protection's ONE off-switch: explicit, named, not arithmetic.
 *   - Neither degenerate value may UNBOUND the protection either (a `NaN` bound is not a
 *     bound).
 */
import { describe, expect, it } from 'bun:test'
import type { Message, ToolCall, ToolResult } from '../types'
import {
  DEFAULT_LIVE_READ_BUDGET_BYTES,
  pruneWireMessages,
  type PruneWireOptions,
} from './prune-wire'
import { ELISION_MARKER } from './op-menu'

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 })
const tc = (id: string, name: string, args: unknown): ToolCall => ({
  type: 'tool_call',
  id,
  name,
  arguments: args,
})
const calls = (...tcs: ToolCall[]): Message => ({
  role: 'assistant',
  content: tcs,
  model: 'm',
  timestamp: 0,
})
const result = (toolCallId: string, toolName: string, content: ToolResult['content']): Message => ({
  role: 'tool',
  results: [{ type: 'tool_result', toolCallId, toolName, content }],
  timestamp: 0,
})

/** Only message 0 and the last message are locked — the reads in between are all prunable. */
const wire = (...body: Message[]): Message[] => [user('the task'), ...body, user('done')]

/** A read of `path` whose result is the model's only live copy of it. */
const read = (id: string, path: string, size: number): Message[] => [
  calls(tc(id, 'read', { path })),
  result(id, 'read', 'L'.repeat(size)),
]

const contentOf = (ms: Message[], id: string): string => {
  for (const m of ms) {
    if (m.role !== 'tool') continue
    const r = m.results.find((x) => x.toolCallId === id)
    if (r && typeof r.content === 'string') return r.content
  }
  throw new Error(`no string result for ${id}`)
}

const isProtected = (ms: Message[], id: string): boolean =>
  !contentOf(ms, id).includes(ELISION_MARKER)

/** The prune window as wide as it goes, so a live read's survival is the ONLY thing under test. */
const OPEN: PruneWireOptions = { keepRecentTokens: 0, minKeepRecent: 1, boundaryQuantum: 1 }

describe('live-read protection — the degenerate inputs (must fail CLOSED)', () => {
  describe('liveReadBudgetBytes is a BUDGET, not a switch', () => {
    // THE BUG. Before the fix the default was `4 × keepRecentTokens` = 0 here, and a
    // 0 budget meant "protect nothing" — so this single legal option silently disabled
    // the protection outright.
    it('keepRecentTokens: 0 does NOT disable the protection', () => {
      const ms = wire(...read('r1', 'a.ts', 800))
      expect(isProtected(pruneWireMessages(ms, OPEN), 'r1')).toBe(true)
    })

    it.each([
      ['0', 0],
      ['negative', -1],
      ['NaN', Number.NaN],
    ])(
      'an explicit %s budget resolves to the safe default, it does not switch the protection off',
      (_label, budget) => {
        const ms = wire(...read('r1', 'a.ts', 800))
        expect(
          isProtected(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: budget }), 'r1'),
        ).toBe(true)
      },
    )

    // A degenerate budget must not UNBOUND the protection either: `NaN` compares false
    // against everything, so `bytes > budgetBytes` was silently true-for-nothing and a
    // read of ANY size sailed through the cap.
    it('a degenerate budget still enforces the default BOUND (it is not "unlimited")', () => {
      const ms = wire(...read('r1', 'a.ts', DEFAULT_LIVE_READ_BUDGET_BYTES + 1))
      for (const budget of [0, -1, Number.NaN, undefined]) {
        expect(
          isProtected(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: budget }), 'r1'),
        ).toBe(false)
      }
    })

    // The fallback must be a fallback, not an unconditional default: a real budget still bounds.
    it('a real (positive) budget is still honored', () => {
      const ms = wire(...read('r1', 'a.ts', 800))
      expect(isProtected(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: 799 }), 'r1')).toBe(
        false,
      )
      expect(isProtected(pruneWireMessages(ms, { ...OPEN, liveReadBudgetBytes: 800 }), 'r1')).toBe(
        true,
      )
    })

    // keepRecentTokens may still scale the budget UP — it just can no longer sink it.
    it('keepRecentTokens still scales the budget up past the floor', () => {
      const big = DEFAULT_LIVE_READ_BUDGET_BYTES + 1_000
      const ms = wire(...read('r1', 'a.ts', big))
      expect(isProtected(pruneWireMessages(ms, OPEN), 'r1')).toBe(false)
      // 4 × 40_000 bytes = 160_000 > big → now it fits.
      expect(isProtected(pruneWireMessages(ms, { ...OPEN, keepRecentTokens: 40_000 }), 'r1')).toBe(
        true,
      )
    })
  })

  describe('maxLiveReads is the ONE off-switch — explicit, named, not arithmetic', () => {
    it('maxLiveReads: 0 still disables the protection', () => {
      const ms = wire(...read('r1', 'a.ts', 800))
      expect(isProtected(pruneWireMessages(ms, { ...OPEN, maxLiveReads: 0 }), 'r1')).toBe(false)
    })

    // `kept.size >= NaN` is always false, so a NaN count used to remove the count bound
    // entirely — every live read in the session survived, however many there were.
    it.each([
      ['NaN', Number.NaN],
      ['negative', -1],
    ])(
      'a %s count falls back to the default bound (6), it does not unbound the count',
      (_label, max) => {
        const ms = wire(
          ...Array.from({ length: 7 }, (_, i) => read(`r${i}`, `f${i}.ts`, 800)).flat(),
        )
        const out = pruneWireMessages(ms, { ...OPEN, maxLiveReads: max })
        // Most-recent-6 win the slots; the oldest read is the one that loses.
        expect(isProtected(out, 'r0')).toBe(false)
        expect(isProtected(out, 'r1')).toBe(true)
        expect(isProtected(out, 'r6')).toBe(true)
      },
    )
  })
})
