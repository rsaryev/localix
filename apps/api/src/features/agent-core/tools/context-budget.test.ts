import { describe, expect, test } from 'bun:test'

import { createContextBudgetTool, describeContextBudget } from './context-budget'

const frame = {
  triggerTokens: 230_400,
  policyWindowTokens: 256_000,
  modelWindowTokens: 1_048_576,
  reservedTokens: 25_600,
  fixedOverheadTokens: 16_625,
  // 85% of the ceiling — what the host passes from its checkpoint policy.
  checkpointAtTokens: 195_840,
}

describe('context_budget', () => {
  test('reports the measured figure, its provenance and the remaining room', () => {
    const text = describeContextBudget({ ...frame, measuredTokens: 24_393 })
    expect(text).toContain('24,393 of 230,400 tokens (11%)')
    expect(text).toContain('measured by the provider')
    // Room left before the next checkpoint, not before the hard ceiling.
    expect(text).toContain('Remaining before the next context checkpoint: 171,447')
    expect(text).toContain('16,625')
    expect(text).not.toContain('Guidance')
  })

  test('an estimate is labelled as one, and a near-full window adds guidance', () => {
    const text = describeContextBudget({ ...frame, estimatedTokens: 200_000 })
    expect(text).toContain('estimated by the runtime')
    expect(text).toContain('Guidance: a checkpoint is near')
    expect(text).toContain('memory')
  })

  test('before the first request the figure is unknown, not zero', () => {
    expect(describeContextBudget(frame)).toContain('Context used: unknown')
  })

  test('the tool reads the host lazily so it follows the run', async () => {
    let measured = 10_000
    const tool = createContextBudgetTool(() => ({ ...frame, measuredTokens: measured }))
    const signal = new AbortController().signal
    expect((await tool.execute('c1', {}, signal)).content).toContain('10,000 of')
    measured = 50_000
    expect((await tool.execute('c2', {}, signal)).content).toContain('50,000 of')
  })

  test('a run without a frame says so instead of inventing numbers', async () => {
    const tool = createContextBudgetTool(() => undefined)
    const result = await tool.execute('c3', {}, new AbortController().signal)
    expect(result.content).toContain('not available')
  })

  test('names where the fixed cost goes when the host provides the breakdown', () => {
    const text = describeContextBudget({
      ...frame,
      measuredTokens: 12_000,
      fixed: {
        promptTokens: 2_000,
        toolTokens: 9_000,
        toolCount: 15,
        heaviestTools: [
          { name: 'activate_tools', tokens: 4_100 },
          { name: 'browser', tokens: 842 },
        ],
      },
    })
    expect(text).toContain('prompt 2,000, 15 tool schemas 9,000')
    expect(text).toContain('heaviest: activate_tools 4,100, browser 842')
  })
})
