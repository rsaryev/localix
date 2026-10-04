/**
 * BOUNDARY tests for `classifyReads` — one per threshold comparison in `live-reads.ts`.
 *
 * This module decides which read results the model KEEPS. Every decision in it is a
 * `>` / `>=` / `<=` against a size, a count or a budget, and a comparison can only be
 * pinned by asserting AT the threshold (a fixture in the middle of the range cannot
 * tell `>` from `>=`). Each test below therefore sits exactly on a boundary and names
 * the mutation it exists to kill; several pair the on-boundary assertion with a control
 * one step away, so the assertion is provably able to flip.
 *
 * Companion: `prune-wire-boundaries.test.ts` pins the same rules one layer down, at
 * wire granularity.
 */
import { describe, expect, it } from 'bun:test'
import { DEFAULT_LIVE_READ_BUDGET_BYTES, classifyReads } from './live-reads'
import { msg, namedTool } from './_test-helpers'

const body = (n: number) => 'x'.repeat(n)
const MIN = 400 // LiveReadOptions.minChars default

describe('classifyReads — supersession threshold (minChars)', () => {
  // A read result AT minChars is `read`'s "unchanged since your earlier read" stub:
  // it delivers no bytes, so it must NOT supersede the read it points at.
  // Kills: live-reads.ts `if (size > minChars)` (supersession) → `>=`.
  // Kills: live-reads.ts `if (chars > minChars && bytes <= budgetBytes)` (candidate) → `>=`.
  it('a read result EXACTLY at minChars neither supersedes nor becomes a live read', () => {
    const first = namedTool('read', { path: 'a.ts' }, { resultText: body(800) })
    const stub = namedTool('read', { path: 'a.ts' }, { resultText: body(MIN) })
    const { live, fates } = classifyReads([msg({ items: [first, stub] })], { minChars: MIN })

    // the earlier read is still the model's only copy of the file
    expect(fates.get(first.toolCallId!)).toBe('live')
    expect(live.has(first.toolCallId!)).toBe(true)
    // the stub itself carries no bytes worth protecting
    expect(live.has(stub.toolCallId!)).toBe(false)
  })

  // Control: ONE char over the threshold and the same read DOES supersede — proving the
  // assertion above can flip, and pinning the other side of the same comparison.
  it('a read result ONE char over minChars supersedes the earlier read of the same file', () => {
    const first = namedTool('read', { path: 'a.ts' }, { resultText: body(800) })
    const second = namedTool('read', { path: 'a.ts' }, { resultText: body(MIN + 1) })
    const { live, fates } = classifyReads([msg({ items: [first, second] })], { minChars: MIN })

    expect(fates.get(first.toolCallId!)).toBe('refreshed')
    expect(live.has(first.toolCallId!)).toBe(false)
    expect(live.has(second.toolCallId!)).toBe(true)
  })
})

describe('classifyReads — only a completed `read` can win protection', () => {
  // `search`/`lsp` results describe many files and are cheaply reproducible: they
  // supersede, but they never take a live-read slot.
  // Kills: live-reads.ts `if (item.name !== 'read' || item.status !== 'completed')` → `&&`.
  it('a `search` result is NOT a live read (a `read` of the same shape is)', () => {
    const search = namedTool('search', { path: 'a.ts' }, { resultText: body(800) })
    expect(classifyReads([msg({ items: [search] })]).live.size).toBe(0)

    // control: identical shape, name `read` → protected. Proves the 0 above is not vacuous.
    const read = namedTool('read', { path: 'a.ts' }, { resultText: body(800) })
    expect(classifyReads([msg({ items: [read] })]).live.size).toBe(1)
  })
})

describe('classifyReads — budgetBytes', () => {
  // A read whose size lands exactly ON the budget still fits it.
  // Kills: live-reads.ts `bytes <= budgetBytes` (candidate) → `<`.
  // Kills: live-reads.ts `if (spent + c.bytes > budgetBytes) continue` → `>=`.
  it('a read EXACTLY at budgetBytes is still protected', () => {
    const read = namedTool('read', { path: 'a.ts' }, { resultText: body(800) })
    const { live } = classifyReads([msg({ items: [read] })], { budgetBytes: 800 })
    expect(live.has(read.toolCallId!)).toBe(true)
  })

  it('a read ONE byte over budgetBytes is not', () => {
    const read = namedTool('read', { path: 'a.ts' }, { resultText: body(801) })
    const { live } = classifyReads([msg({ items: [read] })], { budgetBytes: 800 })
    expect(live.has(read.toolCallId!)).toBe(false)
  })

  it('applies the byte boundary to CJK while minChars remains character-based', () => {
    const resultText = '你'.repeat(MIN + 1) // 401 chars, 1203 UTF-8 bytes
    const read = namedTool('read', { path: 'cjk.ts' }, { resultText })

    expect(
      classifyReads([msg({ items: [read] })], { budgetBytes: 1203 }).live.has(read.toolCallId!),
    ).toBe(true)
    expect(
      classifyReads([msg({ items: [read] })], { budgetBytes: 1202 }).live.has(read.toolCallId!),
    ).toBe(false)
  })

  // The budget is CUMULATIVE: two reads whose sizes sum exactly to it both survive.
  // Kills: live-reads.ts `if (spent + c.bytes > budgetBytes) continue` → `>=`.
  it('two reads summing EXACTLY to budgetBytes are both protected', () => {
    const a = namedTool('read', { path: 'a.ts' }, { resultText: body(600) })
    const b = namedTool('read', { path: 'b.ts' }, { resultText: body(600) })
    const { live } = classifyReads([msg({ items: [a, b] })], { budgetBytes: 1200 })
    expect(live.size).toBe(2)

    // control: one char more and the OLDER read (sorted last) is dropped.
    const c = namedTool('read', { path: 'c.ts' }, { resultText: body(601) })
    const d = namedTool('read', { path: 'd.ts' }, { resultText: body(600) })
    const tight = classifyReads([msg({ items: [c, d] })], { budgetBytes: 1200 })
    expect(tight.live.has(d.toolCallId!)).toBe(true) // most recent wins
    expect(tight.live.has(c.toolCallId!)).toBe(false)
  })
})

describe('classifyReads — malformed limits fail closed', () => {
  it.each([0, -1, Number.NaN])(
    'budgetBytes=%p falls back to the bounded default instead of disabling protection',
    (budgetBytes) => {
      const normal = namedTool('read', { path: 'a.ts' }, { resultText: body(800) })
      const oversized = namedTool(
        'read',
        { path: 'b.ts' },
        {
          resultText: body(DEFAULT_LIVE_READ_BUDGET_BYTES + 1),
        },
      )
      const { live } = classifyReads([msg({ items: [normal, oversized] })], { budgetBytes })

      expect(live.has(normal.toolCallId!)).toBe(true)
      expect(live.has(oversized.toolCallId!)).toBe(false)
    },
  )

  it.each([Number.NaN, -1])(
    'maxLiveReads=%p falls back to the default bound instead of disabling or unbounding it',
    (maxLiveReads) => {
      const reads = Array.from({ length: 7 }, (_, i) =>
        namedTool('read', { path: `f${i}.ts` }, { resultText: body(800) }),
      )
      const { live } = classifyReads([msg({ items: reads })], { maxLiveReads })

      expect(live.size).toBe(6)
      expect(live.has(reads[0].toolCallId!)).toBe(false)
      expect(live.has(reads[6].toolCallId!)).toBe(true)
    },
  )

  it('floors a fractional maxLiveReads instead of exceeding the stated count', () => {
    const read = namedTool('read', { path: 'a.ts' }, { resultText: body(800) })
    expect(classifyReads([msg({ items: [read] })], { maxLiveReads: 0.5 }).live.size).toBe(0)
  })

  it('keeps maxLiveReads: 0 as the explicit protection off-switch', () => {
    const read = namedTool('read', { path: 'a.ts' }, { resultText: body(800) })
    expect(classifyReads([msg({ items: [read] })], { maxLiveReads: 0 }).live.size).toBe(0)
  })
})
