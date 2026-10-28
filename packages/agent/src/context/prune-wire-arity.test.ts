/**
 * ARITY test for `pruneWireMessages`: pruning rewrites message CONTENT and never
 * changes the number of messages.
 *
 * This is not a stylistic preference — a caller depends on it for budget accounting.
 * `history/request-transform.ts` measures the tail the agent loop appended by offsetting
 * into the PRUNED array with a baseline length captured from the UNPRUNED one:
 *
 *   initialContextTokens + estimateWireMessages(pruned, baselineWire.length)
 *
 * That offset is only sound while the two arrays share an index space. If pruning ever
 * dropped or merged a message, the offset would skip past real appended messages, the
 * policy would under-count the request, and it would admit a request over the model's
 * budget — the precise failure that layer exists to prevent, arriving silently as a
 * provider-side context overflow rather than a local policy error.
 *
 * So: change pruning's aggressiveness freely, but if a change makes it drop messages,
 * this test must fail and `history/request-transform.ts` must be reworked in the same change.
 */
import { describe, expect, it } from 'bun:test'
import type { Message, ToolCall, ToolResult } from '../types'
import { pruneWireMessages } from './prune-wire'

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 })
const call = (id: string, path: string): ToolCall => ({
  type: 'tool_call',
  id,
  name: 'Read',
  arguments: { path },
})
const calls = (...tcs: ToolCall[]): Message => ({
  role: 'assistant',
  content: tcs,
  model: 'm',
  timestamp: 0,
})
const result = (toolCallId: string, content: ToolResult['content']): Message => ({
  role: 'tool',
  results: [{ type: 'tool_result', toolCallId, toolName: 'Read', content }],
  timestamp: 0,
})

function toolHeavyWire(pairs: number, resultBytes: number): Message[] {
  const payload = 'y'.repeat(resultBytes)
  const body: Message[] = []
  for (let index = 0; index < pairs; index++) {
    body.push(calls(call(`call-${index}`, `file-${index}.ts`)), result(`call-${index}`, payload))
  }
  return [user('the task'), ...body, user('final')]
}

describe('pruneWireMessages arity', () => {
  it('reclaims bytes without changing the message count', () => {
    const input = toolHeavyWire(12, 30_000)
    const pruned = pruneWireMessages(input, {
      budgetTokens: 2_000,
      pressureTokens: 1_000,
      keepRecentTokens: 100,
      minReclaimTokens: 1,
      recoveryToolAvailable: true,
    })

    // Guard the guard: a run that reclaimed nothing would pass on arity alone.
    const before = JSON.stringify(input).length
    const after = JSON.stringify(pruned).length
    expect(after).toBeLessThan(before / 2)
    expect(pruned).toHaveLength(input.length)
  })

  it('holds arity across every budget, including ones that prune nothing', () => {
    const input = toolHeavyWire(6, 20_000)
    for (const budgetTokens of [0, 1_000, 25_000, 5_000_000]) {
      const pruned = pruneWireMessages(input, {
        budgetTokens,
        pressureTokens: Math.floor(budgetTokens / 2),
        keepRecentTokens: 100,
        minReclaimTokens: 1,
        recoveryToolAvailable: true,
      })
      expect(pruned).toHaveLength(input.length)
    }
  })

  it('holds arity with recovery unavailable, when elision must bound in place instead', () => {
    const input = toolHeavyWire(8, 40_000)
    const pruned = pruneWireMessages(input, {
      budgetTokens: 1_500,
      pressureTokens: 750,
      keepRecentTokens: 100,
      minReclaimTokens: 1,
      recoveryToolAvailable: false,
    })
    expect(pruned).toHaveLength(input.length)
  })

  it('preserves the per-index role sequence, not merely the count', () => {
    const input = toolHeavyWire(10, 30_000)
    const pruned = pruneWireMessages(input, {
      budgetTokens: 2_000,
      pressureTokens: 1_000,
      keepRecentTokens: 100,
      minReclaimTokens: 1,
      recoveryToolAvailable: true,
    })
    expect(pruned.map((message) => message.role)).toEqual(input.map((message) => message.role))
  })
})
