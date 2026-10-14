import { describe, expect, test } from 'bun:test'

import { createHandoffTool, type HandoffOutcome, type HandoffPort } from './handoff'

const tool = (outcome: HandoffOutcome) => {
  const calls: string[][] = []
  const port: HandoffPort = {
    hand: async (handles) => {
      calls.push(handles)
      return outcome
    },
  }
  return { tool: createHandoffTool(port), calls }
}

describe('handoff tool', () => {
  test('hands the floor to the named handles and tells the model to write the brief', async () => {
    const t = tool({ handed: ['qa', 'dev'], unknown: [], available: ['qa', 'dev'] })
    const result = await t.tool.execute('call', { to: ['qa', 'dev'] })
    expect(t.calls).toEqual([['qa', 'dev']])
    expect(String(result.content)).toContain('@qa, @dev')
    expect(result.isError).toBeUndefined()
  })

  test('an unknown handle is an error that lists who is available', async () => {
    const t = tool({ handed: [], unknown: ['ghost'], available: ['qa'] })
    const result = await t.tool.execute('call', { to: ['ghost'] })
    expect(result.isError).toBe(true)
    expect(String(result.content)).toContain('Unknown handles: @ghost. Available: @qa.')
  })

  test('a partly valid batch keeps the valid handles and reports the rest', async () => {
    const t = tool({ handed: ['qa'], unknown: ['ghost'], available: ['qa'] })
    const result = await t.tool.execute('call', { to: ['qa', 'ghost'] })
    expect(result.isError).toBeUndefined()
    expect(String(result.content)).toContain('Handed to @qa.')
    expect(String(result.content)).toContain('Unknown handles: @ghost')
  })

  test('the schema is strict: handles only, one to eight (LOCALIX-190 named five)', () => {
    const { tool: handoff } = tool({ handed: [], unknown: [], available: [] })
    for (const input of [
      {},
      { to: [] },
      { to: Array.from({ length: 9 }, (_, i) => `a${i}`) },
      { to: ['qa'], brief: 'x' },
    ])
      expect(handoff.inputSchema.safeParse(input).success).toBe(false)
    expect(handoff.inputSchema.safeParse({ to: ['qa'] }).success).toBe(true)
    expect(handoff.inputSchema.safeParse({ to: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(true)
  })
})
