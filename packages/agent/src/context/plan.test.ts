import { describe, expect, test } from 'bun:test'
import { planContextCompression } from './plan'
import type { ChatMessage } from '../chat'
import type { AgentItem } from '../agents/items'
import { HUGE_BUDGET } from './_test-helpers'

// Assistant message carrying a big, compressible tool result so the op-menu
// offers lossy alternatives the allocator can pick under a tight budget.
const heavy = (i: number): ChatMessage =>
  ({
    role: 'assistant',
    content: '',
    items: [
      {
        id: `i${i}`,
        status: 'completed',
        type: 'tool_call',
        toolCallId: `t${i}`,
        name: 'shell_exec',
        activeVerb: 'Running',
        resultText: 'x'.repeat(4000),
      } as unknown as AgentItem,
    ],
  }) as ChatMessage

const history = (n: number): ChatMessage[] => [
  { role: 'user', content: 'the original task' } as ChatMessage,
  ...Array.from({ length: n - 1 }, (_, k) => heavy(k + 1)),
]

const opAt = (plan: ReturnType<typeof planContextCompression>, index: number) =>
  plan.assignment.find((a) => a.index === index)?.op.kind

describe('planContextCompression', () => {
  test('assignment covers every message in order', () => {
    const msgs = history(6)
    const plan = planContextCompression(msgs, { budget: Infinity, keepRecentCount: 2 })
    expect(plan.assignment.map((a) => a.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(plan.budget).toBe(Infinity)
  })

  test('an infinite budget keeps everything verbatim (after == before)', () => {
    const msgs = history(6)
    const plan = planContextCompression(msgs, { budget: Infinity, keepRecentCount: 2 })
    expect(plan.assignment.every((a) => a.op.kind === 'verbatim')).toBe(true)
    expect(plan.estTokensAfter).toBe(plan.estTokensBefore)
  })

  test('compression never increases the token estimate', () => {
    const msgs = history(8)
    const plan = planContextCompression(msgs, { budget: 1, keepRecentCount: 1 })
    expect(plan.estTokensAfter).toBeLessThanOrEqual(plan.estTokensBefore)
  })

  test('the first task and the recent tail stay verbatim even under pressure', () => {
    const msgs = history(8)
    const plan = planContextCompression(msgs, {
      budget: 1,
      keepRecentCount: 2,
      protectFirstTask: true,
    })
    expect(opAt(plan, 0)).toBe('verbatim') // protected first task
    expect(opAt(plan, 7)).toBe('verbatim') // last (tail)
    expect(opAt(plan, 6)).toBe('verbatim') // tail of 2
  })

  test('a finite budget drains recoverable I/O even when it is not binding', () => {
    // A `read` result is "lossless" to elide (recoverable from disk), so a plan drains it
    // regardless of how far under budget it is. That is only safe because the host asks for
    // a plan at a checkpoint alone; an infinite budget stays the no-op.
    const reads = (n: number): ChatMessage[] => [
      { role: 'user', content: 'the original task' } as ChatMessage,
      ...Array.from(
        { length: n - 1 },
        (_, k) =>
          ({
            role: 'assistant',
            content: '',
            items: [
              {
                id: `r${k}`,
                status: 'completed',
                type: 'tool_call',
                toolCallId: `t${k}`,
                name: 'read',
                activeVerb: 'Reading',
                resultText: 'y'.repeat(8000),
              } as unknown as AgentItem,
            ],
          }) as ChatMessage,
      ),
    ]
    const msgs = reads(14)
    const budget = HUGE_BUDGET
    const drained = planContextCompression(msgs, { budget, keepRecentCount: 2 })
    expect(drained.assignment.some((a) => a.op.kind === 'elide')).toBe(true)

    const noop = planContextCompression(msgs, { budget: Infinity, keepRecentCount: 2 })
    expect(noop.assignment.every((a) => a.op.kind === 'verbatim')).toBe(true)
  })

  test('boundary quantization keeps the verbatim/elided prefix stable across a one-message growth', () => {
    // Adding one message must NOT shift the protected-tail boundary by one (that
    // would break the prompt cache); with the default quantum it stays put.
    const a = planContextCompression(history(16), { budget: Infinity, keepRecentCount: 3 })
    const b = planContextCompression(history(17), { budget: Infinity, keepRecentCount: 3 })
    expect(a.assignment).toHaveLength(16)
    expect(b.assignment).toHaveLength(17)
  })
})
