import { describe, expect, it } from 'bun:test'
import { pruneWireMessages } from './prune-wire'
import { estimateTextTokens } from './tokens'
import type { Message } from '../types'

/**
 * AGGREGATE size of the pruned wire, which nothing pinned.
 *
 * The existing suites cover per-message behaviour and boundary selection thoroughly. What no test
 * asserted is the total a request can carry, and that is the number a context window is spent on.
 * These were written from measurement, not from reading: a 5 MB single result reaches the wire as
 * ~52 KiB, and 200 × 50 KB collapse to ~240 KiB with 198 of them pointered.
 *
 * The fixture shape is load-bearing and was got wrong first: a call must be
 * `{ type: 'tool_call', id, name, arguments }` and a result `{ type: 'tool_result', toolCallId,
 * toolName, content }`. With `tool_use`/`input` — the provider-facing spelling — the pruner cannot
 * pair calls with results, elides NOTHING, and every assertion below passes vacuously while
 * reporting megabytes. That is worth stating, because a vacuous pass here looks exactly like a
 * healthy bound.
 */
const bytesOf = (messages: Message[]) => new TextEncoder().encode(JSON.stringify(messages)).length

function transcript(resultBytes: number, count: number): Message[] {
  const out: Message[] = []
  const body = (n: number) =>
    Array.from({ length: Math.ceil(n / 40) }, (_, k) => `line ${k} of output payload`).join('\n')
  for (let i = 0; i < count; i++) {
    out.push({
      role: 'assistant',
      content: [
        { type: 'tool_call', id: `tc-${i}`, name: 'bash', arguments: { command: `run ${i}` } },
      ],
      model: 'm',
      timestamp: i,
    } as never)
    out.push({
      role: 'tool',
      results: [
        {
          type: 'tool_result',
          toolCallId: `tc-${i}`,
          toolName: 'bash',
          content: body(resultBytes),
        },
      ],
      timestamp: i,
    } as never)
  }
  return out
}

const pointeredCount = (messages: Message[]) =>
  messages.filter(
    (m) => (m as { role: string }).role === 'tool' && JSON.stringify(m).length < 2_000,
  ).length

describe('pruned wire — aggregate size', () => {
  it('never lets one enormous result through whole', () => {
    const pruned = pruneWireMessages(transcript(5_000_000, 1))
    // 3.6 MiB in. Per-result bounding alone has to carry this: there is nothing older to elide.
    expect(bytesOf(pruned)).toBeLessThan(128 * 1024)
  })

  it('collapses a long tool loop into pointers rather than growing without limit', () => {
    const input = transcript(50_000, 200)
    const pruned = pruneWireMessages(input, { budgetTokens: 120_000, fixedOverheadTokens: 8_000 })
    expect(bytesOf(input)).toBeGreaterThan(4 * 1024 * 1024)
    expect(bytesOf(pruned)).toBeLessThan(512 * 1024)
    // Almost all of them: only the protected recent window keeps its content.
    expect(pointeredCount(pruned)).toBeGreaterThan(190)
  })

  /**
   * `budgetTokens` holds as a hard ceiling even for a run of large recent results.
   *
   * It did not. `boundToolResults` bounds EACH result to a ~51 KiB tail excerpt plus a
   * `tool_output` pointer — right for one result — and `prunedText` opened with
   * `if (isCompressedContent(text)) return text`, which made elision monotone and the prompt
   * prefix stable at the cost of making the aggregate unshrinkable. So the retained total was
   * N x 51 KiB, linear in the number of recent results and indifferent to the budget. The
   * release pass that exists for exactly this ("progressively release the OLDEST optional tail
   * messages and prune them too") reclaimed nothing, because every candidate was already
   * compressed.
   *
   * Measured with the pruner's own estimator, plus 8k of fixed overhead:
   *                              before        after
   *   10 x 500 KB, budget 120k   141_030   →   35_430
   *   20 x 500 KB, budget 120k   274_060   →   36_460
   *   10 x 500 KB, budget  40k   141_030   →   35_430   (the budget had NO effect before)
   *
   * `pointerOnlyBody` drops the excerpt when — and only when — the request is over the ceiling.
   * The bracketed clause already names `tool_output(action="get", tool_call_id=…)`, so nothing
   * unrecoverable is lost, and giving up the excerpt to fit is the same trade the boundary
   * quantum already collapses for over budget.
   */
  it('holds budgetTokens as a hard ceiling, keeping recovery pointers', () => {
    const overhead = 8_000
    const budget = 120_000
    const est = (messages: Message[]) =>
      messages.reduce((sum, m) => sum + estimateTextTokens(JSON.stringify(m)), 0)

    const ten = pruneWireMessages(transcript(500_000, 10), {
      budgetTokens: budget,
      fixedOverheadTokens: overhead,
    })
    expect(est(ten) + overhead).toBeLessThan(budget)
    // The excerpt goes; the route back to the bytes does not.
    expect(JSON.stringify(ten)).toContain('tool_output(action=\\"get\\", tool_call_id=')

    // No longer linear in the count: twice the results cost roughly the same.
    const twenty = pruneWireMessages(transcript(500_000, 20), {
      budgetTokens: budget,
      fixedOverheadTokens: overhead,
    })
    expect(est(twenty) + overhead).toBeLessThan(budget)
    expect(est(twenty)).toBeLessThan(est(ten) * 1.2)

    // A tighter budget is now honoured rather than ignored.
    const tight = pruneWireMessages(transcript(500_000, 10), {
      budgetTokens: 40_000,
      fixedOverheadTokens: overhead,
    })
    expect(est(tight) + overhead).toBeLessThan(40_000)
  })

  /**
   * What `pointerOnlyBody` actually preserves across turns — and what it does NOT.
   *
   * The commit that added it claimed monotonicity. That claim was stronger than the truth, and
   * this test is written from measurement rather than from the claim:
   *
   *  - Two identical OVER-BUDGET turns are byte-identical. `pointerOnlyBody` is idempotent (a
   *    bare clause is its own leading clause), so there is no oscillation and no per-turn prefix
   *    churn while the pressure lasts. This is the property that matters most, because it is the
   *    one the bypassed early return existed to protect.
   *  - A later COMFORTABLE turn keeps every result ELIDED — it never returns to raw output — but
   *    it does RE-INFLATE a pointer-only body back to the ~51 KiB bounded excerpt, because the
   *    ratchet records "this call was elided", not "this call was reduced to a pointer", and
   *    `boundToolResults` re-derives the excerpt from the original transcript every turn.
   *
   * So the prefix is stable under sustained pressure and changes once when the pressure lifts.
   * That is the same trade the boundary quantum already makes (it collapses to 1 over budget and
   * widens again after), and a budget transition is an event rather than per-turn noise — but it
   * is a real cost and it is recorded here rather than left as an unexamined "monotone".
   */
  it('is byte-stable across consecutive over-budget turns', () => {
    const opts = { budgetTokens: 120_000, fixedOverheadTokens: 8_000 }
    const input = transcript(500_000, 10)
    expect(JSON.stringify(pruneWireMessages(input, opts))).toBe(
      JSON.stringify(pruneWireMessages(input, opts)),
    )
  })

  it('never returns to raw output once the pressure lifts, but does restore the excerpt', () => {
    const input = transcript(500_000, 10)
    const underPressure = pruneWireMessages(input, {
      budgetTokens: 120_000,
      fixedOverheadTokens: 8_000,
    })
    const elidedToolCallIds = new Set(
      Array.from({ length: 10 }, (_, i) => `tc-${i}`).filter((id) =>
        JSON.stringify(underPressure).includes(`tool_call_id=\\"${id}`),
      ),
    )
    expect(elidedToolCallIds.size).toBeGreaterThan(0)

    const relaxed = pruneWireMessages(input, {
      budgetTokens: 10_000_000,
      fixedOverheadTokens: 8_000,
      elidedToolCallIds,
    })
    const sizeOf = (id: string) =>
      JSON.stringify(
        relaxed.find(
          (m) => (m as { role: string }).role === 'tool' && JSON.stringify(m).includes(`"${id}"`),
        ),
      ).length

    for (const id of elidedToolCallIds) {
      // Still bounded — nowhere near the 500 KB original…
      expect(sizeOf(id)).toBeLessThan(80_000)
      // …but the excerpt IS back, so this is not pointer-only. Asserting "< 2 KiB" here fails,
      // which is how the overstated monotonicity claim was caught.
      expect(sizeOf(id)).toBeGreaterThan(2_000)
    }
  })

  it('leaves a comfortable request untouched — no excerpt is given up to fit', () => {
    const pruned = pruneWireMessages(transcript(50_000, 3), {
      budgetTokens: 1_000_000,
      fixedOverheadTokens: 8_000,
    })
    // Under the ceiling nothing is compressed at all, so there is no pointer to find.
    expect(JSON.stringify(pruned)).not.toContain('tool_output(action=\\"get\\", tool_call_id=')
  })
})
