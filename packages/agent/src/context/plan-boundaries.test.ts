/**
 * BOUNDARY tests for `planContextCompression` — the thresholds that decide WHETHER the
 * turn-start VBC pass compresses at all, and WHICH messages it is allowed to touch.
 *
 * These are the highest-consequence comparisons in the layer: none of them crashes, none
 * of them fails a type-check, and a wrong one silently changes what the model can still
 * see. A mutation sweep found 16 of them invisible to the suite — because every existing
 * fixture sits in the MIDDLE of a range, and a mid-range fixture cannot tell `>` from
 * `>=`. Each test below sits exactly ON a threshold and names the mutation it kills.
 */
import { describe, expect, it } from 'bun:test'
import type { ChatMessage } from '../chat'
import { planContextCompression } from './plan'
import { applyPlan } from './apply'
import { buildDepGraph } from './dep-graph'
import type { OperationFloor } from './op-floor'
import { DEFAULT_VALUE_WEIGHTS } from './value'
import { estimateChatMessageTokens } from './tokens'
import { HUGE_BUDGET, msg, namedTool, userMsg } from './_test-helpers'

/** A message whose payload is RECOVERABLE (a write's content) ⇒ its menu offers `elide`. */
const writeMsg = (i: number, chars: number): ChatMessage =>
  msg({ items: [namedTool('write', { path: `f${i}.ts`, content: 'W'.repeat(chars) })] })

/** A message whose payload is NON-recoverable (bash output) ⇒ its menu is the lossy chain. */
const bashMsg = (i: number, chars: number): ChatMessage =>
  msg({
    items: [namedTool('bash', { command: `bun test ${i}` }, { resultText: 'L'.repeat(chars) })],
  })

/** No pressure gate, no quantization noise, first message NOT auto-locked. */
const base = { budget: HUGE_BUDGET, protectFirstTask: false, boundaryQuantum: 1 } as const

const kinds = (msgs: ChatMessage[], opts: Parameters<typeof planContextCompression>[1]) =>
  planContextCompression(msgs, opts).assignment.map((a) => a.op.kind)

describe('planContextCompression — the supersession threshold', () => {
  const msgs = [writeMsg(0, 4000), userMsg('a'), userMsg('b')]
  const plan = (supersededThreshold?: number) =>
    planContextCompression(msgs, {
      ...base,
      keepRecentCount: 2,
      ...(supersededThreshold === undefined ? {} : { supersededThreshold }),
    })

  // Kills: `operationMenu(m, graph.supersededScore(i) >= supThreshold, …)` → `>`.
  it('a score EXACTLY at the threshold counts as superseded', () => {
    // precondition: nothing observes f0.ts again, so its supersession score is exactly 0 —
    // which puts `supersededThreshold: 0` exactly ON the comparison's boundary.
    const graph = buildDepGraph(msgs, { recencyHalfLife: DEFAULT_VALUE_WEIGHTS.recencyHalfLife })
    expect(graph.supersededScore(0)).toBe(0)

    // superseded ⇒ the elide is treated as near-free (0.99), not merely recoverable (0.95)
    expect(plan(0).assignment[0].op.kind).toBe('elide')
    expect(plan(0).assignment[0].op.retention).toBeCloseTo(0.99, 5)

    // control, one step above the boundary: not superseded ⇒ 0.95
    expect(plan().assignment[0].op.retention).toBeCloseTo(0.95, 5)
  })
})

describe('planContextCompression — the hard-keep tail', () => {
  // Kills: `if (protectFirst && N > 0) locked.add(0)` → `||` (which locks message 0
  // whatever the caller asked for).
  it('honours protectFirstTask:false — the first message becomes compressible', () => {
    const msgs = [writeMsg(0, 4000), userMsg('a'), userMsg('b'), userMsg('c')]
    expect(kinds(msgs, { ...base, keepRecentCount: 2 })[0]).toBe('elide')
    // control: the default DOES lock the original task verbatim
    expect(kinds(msgs, { budget: HUGE_BUDGET, boundaryQuantum: 1, keepRecentCount: 2 })[0]).toBe(
      'verbatim',
    )
  })

  // Kills: `for (let i = N - 1; i >= 0 && …; i--)` → `i > 0` (which can never lock
  // message 0 into the tail, whatever keepRecentCount says).
  it('the tail can reach message 0 when keepRecentCount covers the whole history', () => {
    const msgs = [writeMsg(0, 4000), userMsg('end')]
    expect(kinds(msgs, { ...base, keepRecentCount: 5 })[0]).toBe('verbatim')
    // control: a tail of 1 leaves message 0 outside it
    expect(kinds(msgs, { ...base, keepRecentCount: 1 })[0]).toBe('elide')
  })

  // A normal recent message fitting the cap stays locked; the next one does not.
  it('keeps exactly ONE recent message when the cap admits only one', () => {
    const msgs = [writeMsg(0, 4000), writeMsg(1, 4000), writeMsg(2, 100)]
    const cap = estimateChatMessageTokens(msgs[2]) // room for the last message and nothing else
    const k = kinds(msgs, { ...base, keepRecentCount: 5, keepRecentTokens: cap })
    expect(k[2]).toBe('verbatim') // locked despite the cap being exactly used up
    expect(k[1]).toBe('elide') // the second would exceed it ⇒ not locked
  })

  it('does not hard-lock one tool-heavy tail that alone exceeds the cap', () => {
    const oversized = bashMsg(9, 200_000)
    const cap = 2_000
    expect(estimateChatMessageTokens(oversized)).toBeGreaterThan(cap)
    const plan = planContextCompression([userMsg('task'), oversized], {
      budget: 8_000,
      keepRecentCount: 5,
      keepRecentTokens: cap,
      boundaryQuantum: 1,
    })
    const tail = plan.assignment[1]
    expect(tail.op.kind).not.toBe('verbatim')
    expect(tail.op.cost).toBeLessThanOrEqual(cap)
    expect(plan.estTokensAfter).toBeLessThanOrEqual(plan.budget)
    const originalItem = oversized.items![0] as { toolCallId: string; resultText?: string }
    const wireItem = applyPlan([userMsg('task'), oversized], plan)[1].items![0] as {
      toolCallId: string
      resultText?: string
    }
    expect(wireItem.toolCallId).toBe(originalItem.toolCallId)
    expect(wireItem.resultText).toContain(
      `tool_output(action="get", tool_call_id="${originalItem.toolCallId}")`,
    )
    expect(originalItem.resultText).toHaveLength(200_000)
  })

  // Kills: `tailTokens + t > tokenCap` → `>=`.
  it('a message landing EXACTLY on the token cap is still locked', () => {
    const msgs = [writeMsg(0, 4000), writeMsg(1, 4000), writeMsg(2, 4000)]
    const cap = estimateChatMessageTokens(msgs[1]) + estimateChatMessageTokens(msgs[2])
    const k = kinds(msgs, { ...base, keepRecentCount: 5, keepRecentTokens: cap })
    expect(k[2]).toBe('verbatim')
    expect(k[1]).toBe('verbatim') // sum lands exactly ON the cap → fits
    expect(k[0]).toBe('elide') // one more would exceed it
  })
})

describe('planContextCompression — the lossless drain', () => {
  const msgs = [writeMsg(0, 4000), writeMsg(1, 200)]

  // Kills: `Number.isFinite(opts.budget)` → `true` (an infinite budget must stay a no-op).
  it('drains a recoverable write under any finite budget, and never under an infinite one', () => {
    expect(kinds(msgs, { ...base, keepRecentCount: 1 })[0]).toBe('elide')
    expect(kinds(msgs, { ...base, budget: Infinity, keepRecentCount: 1 })[0]).toBe('verbatim')
  })
})

describe('planContextCompression — opFloor is a FLOOR, never a ceiling', () => {
  // The floor may only RAISE a message's op index (never hand back content it already
  // took). The `||` mutant turns the same line into a CEILING: a recorded floor of 1
  // would drag a message the budget drove to `pointer` back up to `truncate`, re-billing
  // its body and overshooting the budget the allocator just satisfied.
  // Kills: `if (floor !== undefined && floor > opIndex[i])` → `||`.
  it('a recorded floor BELOW the allocator’s choice leaves that choice alone', () => {
    const msgs = [
      userMsg('the original task'),
      ...Array.from({ length: 12 }, (_, k) => bashMsg(k, 8000)),
    ]
    const opts = (opFloor?: Map<string, OperationFloor>) => ({
      budget: 6_000,
      keepRecentCount: 2,
      keepRecentTokens: 4_000,
      boundaryQuantum: 1,
      ...(opFloor ? { opFloor } : {}),
    })

    const noMemory = planContextCompression(msgs, opts()).assignment
    const heavy = noMemory.find((a) => a.op.kind === 'pointer' || a.op.kind === 'oneline')
    expect(heavy).toBeDefined() // the budget really does bind

    // seed the WEAKEST possible non-verbatim floor for that message
    const floor = new Map<string, OperationFloor>([
      [msgs[heavy!.index].id as string, { kind: 'truncate', maxChars: 2_000 }],
    ])
    const withFloor = planContextCompression(msgs, opts(floor)).assignment
    expect(withFloor[heavy!.index].op.kind).toBe(heavy!.op.kind)
  })
})
