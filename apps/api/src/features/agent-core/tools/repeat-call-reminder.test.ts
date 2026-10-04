import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import type { AgentTool } from '@localixai/agent/agents'
import { wrapToolsWithRepeatCallReminder } from './repeat-call-reminder'

/** A tool that always SUCCEEDS — the loop shape failure-guard is blind to. */
function okTool(name: string) {
  return defineAgentTool({
    name,
    description: 'test',
    activeVerb: 'Working',
    inputSchema: z.looseObject({ q: z.string() }),
    async execute(_id, input) {
      return { content: `result for ${JSON.stringify(input)}`, isError: false }
    },
  })
}

/**
 * The wrapper erases the input type — it wraps `readonly AgentTool[]` and hands back
 * `AgentTool[]` (i.e. `AgentTool<unknown>`), so the wrapped tool is deliberately
 * typed at the erased contract the wrapper actually promises, not at the fixture's.
 */
const run = (tool: AgentTool, input: unknown) => tool.execute('c', input)

describe('wrapToolsWithRepeatCallReminder', () => {
  test('appends a generic hint on the 3rd identical SUCCESSFUL call, not the 2nd', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('grep')])
    expect((await run(tool, { q: 'x' })).content).not.toContain('[guardrail]')
    expect((await run(tool, { q: 'x' })).content).not.toContain('[guardrail]')
    const third = await run(tool, { q: 'x' })
    expect(third.content).toContain('[guardrail]')
    expect(third.content).toContain('repeated 3×')
    expect(third.terminate).toBeUndefined() // hint, not stop
  })

  test('a DIFFERENT call resets the identical chain', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('grep')])
    await run(tool, { q: 'x' })
    await run(tool, { q: 'x' })
    await run(tool, { q: 'other' }) // resets
    expect((await run(tool, { q: 'x' })).content).not.toContain('[guardrail]') // count 1 again
    expect((await run(tool, { q: 'x' })).content).not.toContain('[guardrail]') // count 2
  })

  test('an EXCLUDED bookkeeping tool between two identical calls neither counts nor resets', async () => {
    const [grep, memory] = wrapToolsWithRepeatCallReminder([okTool('grep'), okTool('memory')])
    await run(grep, { q: 'x' })
    const memoryRes = await run(memory, { q: 'note' }) // transparent
    expect(memoryRes.content).not.toContain('[guardrail]')
    await run(grep, { q: 'x' }) // still consecutive: count 2
    const third = await run(grep, { q: 'x' })
    expect(third.content).toContain('repeated 3×') // chain survived the bookkeeping call
  })

  describe('a tool whose every call has its own effect (idempotentHint: false)', () => {
    /** A board: the same input moves it, and each answer is the board after that call. */
    function boardTool(answers: string[]) {
      let call = 0
      return defineAgentTool({
        name: 'board_move',
        description: 'test',
        activeVerb: 'Playing',
        behaviorHints: { idempotentHint: false },
        inputSchema: z.looseObject({ q: z.string() }),
        async execute() {
          return { content: answers[Math.min(call++, answers.length - 1)]!, isError: false }
        },
      })
    }

    test('the same input with a new answer each time is play, not a loop', async () => {
      const [tool] = wrapToolsWithRepeatCallReminder([
        boardTool(Array.from({ length: 12 }, (_, move) => `board after batch ${move}`)),
      ])
      for (let batch = 0; batch < 12; batch++) {
        const result = await run(tool, { q: 'down,left' })
        expect(result.content).not.toContain('[guardrail]')
        expect(result.terminate).toBeUndefined()
      }
    })

    test('control: the same input with the SAME answer is still a loop', async () => {
      const [tool] = wrapToolsWithRepeatCallReminder([
        boardTool(['board moved', 'nothing moved', 'nothing moved', 'nothing moved']),
      ])
      await run(tool, { q: 'left' })
      await run(tool, { q: 'left' })
      await run(tool, { q: 'left' })
      expect((await run(tool, { q: 'left' })).content).toContain('repeated 3×')
    })

    test('control: a tool that does not declare it is keyed on the call alone', async () => {
      let call = 0
      const [tool] = wrapToolsWithRepeatCallReminder([
        defineAgentTool({
          name: 'bash',
          description: 'test',
          activeVerb: 'Running',
          inputSchema: z.looseObject({ q: z.string() }),
          async execute() {
            return { content: `failed after ${call++}ms`, isError: true }
          },
        }),
      ])
      await run(tool, { q: 'bun test' })
      await run(tool, { q: 'bun test' })
      expect((await run(tool, { q: 'bun test' })).content).toContain('repeated 3×')
    })
  })

  test('key order in input does not create a distinct signature', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('bash')])
    await run(tool, { q: 'x', extra: 'd' })
    await run(tool, { extra: 'd', q: 'x' })
    const third = await run(tool, { q: 'x', extra: 'd' })
    expect(third.content).toContain('repeated 3×') // all three collided into one signature
  })

  test('detailed hint at 5 names the tool, the count, and a preview of the canonical args', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('grep')])
    for (let i = 0; i < 4; i++) await run(tool, { q: 'x' })
    const fifth = await run(tool, { q: 'x' })
    expect(fifth.content).toContain('`grep`')
    expect(fifth.content).toContain('5×')
    expect(fifth.content).toContain('{"q":"x"}') // canonical-args preview
    expect(fifth.terminate).toBeUndefined()
  })

  test('A-B-A-B fires on the 2nd complete cycle with NO identical consecutive pair', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('edit')])
    const a = { q: 'edit' }
    const b = { q: 'test' }
    expect((await run(tool, a)).content).not.toContain('[guardrail]')
    expect((await run(tool, b)).content).not.toContain('[guardrail]')
    expect((await run(tool, a)).content).not.toContain('[guardrail]')
    const fourth = await run(tool, b) // A-B-A-B buffered = 2 full cycles
    expect(fourth.content).toContain('[guardrail]')
    expect(fourth.content).toContain('alternate')
    expect(fourth.terminate).toBeUndefined()
  })

  test('A-B-A-B terminates on the 4th complete cycle', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('edit')])
    const a = { q: 'edit' }
    const b = { q: 'test' }
    // 8 alternating calls = A B A B A B A B = 4 full cycles.
    for (let i = 0; i < 7; i++) {
      const res = await run(tool, i % 2 === 0 ? a : b)
      expect(res.terminate).toBeUndefined()
    }
    const eighth = await run(tool, b)
    expect(eighth.terminate).toBe(true)
    expect(eighth.content).toContain('being stopped')
  })

  test('a non-alternating call resets the cycle chain', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('edit')])
    const a = { q: 'edit' }
    const b = { q: 'test' }
    await run(tool, a)
    await run(tool, b)
    await run(tool, a)
    await run(tool, { q: 'elsewhere' }) // breaks the period-2 window
    expect((await run(tool, b)).content).not.toContain('[guardrail]')
  })

  test('hard-terminates on the 8th identical call, hinting before', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('grep')])
    for (let i = 0; i < 7; i++) {
      const res = await run(tool, { q: 'x' })
      expect(res.terminate).toBeUndefined()
    }
    const eighth = await run(tool, { q: 'x' })
    expect(eighth.terminate).toBe(true)
    expect(eighth.content).toContain('8×')
    expect(eighth.content).toContain('being stopped')
  })

  test('after a hard stop, EVERY subsequent call terminates without executing (latch)', async () => {
    let sideEffects = 0
    const healthy = defineAgentTool({
      name: 'read',
      description: 't',
      activeVerb: 'Reading',
      inputSchema: z.object({ path: z.string() }),
      async execute() {
        sideEffects += 1
        return { content: 'ok' }
      },
    })
    const [stuck, wrappedHealthy] = wrapToolsWithRepeatCallReminder([okTool('grep'), healthy])
    for (let i = 0; i < 8; i++) await run(stuck, { q: 'x' })

    const after = await wrappedHealthy.execute('c', { path: 'other.ts' })
    expect(after.terminate).toBe(true)
    expect(after.isError).toBe(true)
    expect(after.content).toContain('NOT executed')
    expect(sideEffects).toBe(0)
    // And the stuck tool itself is latched too, even with a fresh input.
    const again = await run(stuck, { q: 'brand-new' })
    expect(again.terminate).toBe(true)
  })

  test('ERROR results count toward the identical chain too (a tool that keeps failing is a loop)', async () => {
    const denied = defineAgentTool({
      name: 'push',
      description: 't',
      activeVerb: 'Pushing',
      inputSchema: z.object({ q: z.string() }),
      async execute() {
        return { content: 'permission denied', isError: true }
      },
    })
    const [tool] = wrapToolsWithRepeatCallReminder([denied])
    await run(tool, { q: 'x' })
    await run(tool, { q: 'x' })
    const third = await run(tool, { q: 'x' })
    expect(third.content).toContain('repeated 3×')
  })

  test('big args: preview is head-truncated to 500 chars but detection stays exact', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('write')])
    const big = { q: 'a'.repeat(2000) }
    for (let i = 0; i < 4; i++) await run(tool, big)
    const fifth = await run(tool, big) // detailed hint carries the preview
    expect(fifth.content).toContain('5×') // detection matched the FULL canonical args
    const hint = fifth.content.split('[guardrail]')[1] ?? ''
    expect(hint.length).toBeLessThan(800) // 500-char preview + fixed prose, not 2000+ of args
    expect(hint).toContain('…') // truncation marker
    // A near-identical big input beyond the preview cutoff is NOT a repeat.
    const almostBig = { q: `${'a'.repeat(1999)}b` }
    const different = await run(tool, almostBig)
    expect(different.content).not.toContain('[guardrail]') // chain reset — full-string comparison
  })

  test('thresholds are configurable', async () => {
    const [tool] = wrapToolsWithRepeatCallReminder([okTool('grep')], {
      identicalThresholds: [2, 3, 4],
    })
    expect((await run(tool, { q: 'x' })).content).not.toContain('[guardrail]')
    expect((await run(tool, { q: 'x' })).content).toContain('repeated 2×')
    expect((await run(tool, { q: 'x' })).content).toContain('{"q":"x"}') // detailed at 3
    expect((await run(tool, { q: 'x' })).terminate).toBe(true) // hard stop at 4
  })
})
