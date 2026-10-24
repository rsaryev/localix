import { describe, expect, it } from 'bun:test'

import { nextStopContinuation } from './stop-continuation-cap'

/** The run after `count` consecutive Stop-hook continuations, as Claude Code counts them. */
function chainOf(blocks: number, opts: { toolCallsEachRun?: number; cap?: string } = {}) {
  let count = 0
  for (let i = 0; i < blocks; i++) {
    const next = nextStopContinuation(count, opts.toolCallsEachRun ?? 0, {
      CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: opts.cap,
    })
    if (next === null) return i
    count = next
  }
  return blocks
}

describe('Stop hook continuation cap', () => {
  it('lets a stop hook continue the turn eight times in a row, then ends it', () => {
    expect(chainOf(20)).toBe(8)
  })

  it('resets the count each time the agent calls a tool', () => {
    expect(chainOf(20, { toolCallsEachRun: 1 })).toBe(20)
  })

  it('CLAUDE_CODE_STOP_HOOK_BLOCK_CAP raises the cap', () => {
    expect(chainOf(20, { cap: '12' })).toBe(12)
    expect(chainOf(20, { cap: 'nonsense' })).toBe(8)
  })
})
