import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'
import { wrapToolsWithMistakeBreaker } from './mistake-breaker'

/** A tool that returns whatever result the test scripted for each call. */
function scriptedTool(name: string, results: Array<Partial<AgentToolResult>>) {
  let i = 0
  return defineAgentTool({
    name,
    description: 'test',
    activeVerb: 'Testing',
    inputSchema: z.object({ v: z.string() }),
    async execute() {
      const r = results[Math.min(i++, results.length - 1)]
      return { content: 'out', ...r }
    },
  })
}

const run = (tool: AgentTool, v: string) => tool.execute('c', { v })

const fail = (content: string): Partial<AgentToolResult> => ({ content, isError: true })
const invalid = (content: string): Partial<AgentToolResult> => ({
  content,
  isError: true,
  error: { kind: 'validation', message: content, userMessage: content },
})

describe('wrapToolsWithMistakeBreaker', () => {
  test('VARIED failures across different tools stop at 5 with a per-reason breakdown', async () => {
    const [edit, bash] = wrapToolsWithMistakeBreaker([
      scriptedTool('edit', [
        invalid('old_string not found'),
        invalid('missing path'),
        fail('edit failed'),
      ]),
      scriptedTool('bash', [fail('exit 127'), fail('exit 1')]),
    ])
    // Five DIFFERENT failing calls — no identical signature, so failure-guard would
    // only ever hint; the cross-reason breaker is the one that stops.
    expect((await run(edit, 'a')).terminate).toBeUndefined()
    expect((await run(bash, 'b')).terminate).toBeUndefined()
    expect((await run(edit, 'c')).terminate).toBeUndefined()
    expect((await run(bash, 'd')).terminate).toBeUndefined()
    const fifth = await run(edit, 'e')
    expect(fifth.terminate).toBe(true)
    expect(fifth.content).toContain('5 consecutive failures')
    expect(fifth.content).toContain('2 invalid tool calls')
    expect(fifth.content).toContain('3 execution failures')
    expect(fifth.content).toContain('last: edit: edit failed')
    expect(fifth.content).toContain('Session state was preserved. Send a new prompt to resume.')

    // Latch: the NEXT call short-circuits with terminate and never executes — pi ends
    // a batch only when ALL results terminate.
    const after = await run(bash, 'f')
    expect(after.terminate).toBe(true)
    expect(after.content).toContain('NOT executed')
  })

  test('a success between failures resets the streak', async () => {
    const [tool] = wrapToolsWithMistakeBreaker([
      scriptedTool('bash', [
        fail('1'),
        fail('2'),
        fail('3'),
        fail('4'),
        { content: 'ok' },
        fail('5'),
        fail('6'),
      ]),
    ])
    for (const v of ['a', 'b', 'c', 'd']) expect((await run(tool, v)).terminate).toBeUndefined()
    expect((await run(tool, 'ok')).isError).toBeUndefined()
    // Two more failures after the success: 2 < 5, no stop.
    expect((await run(tool, 'e')).terminate).toBeUndefined()
    expect((await run(tool, 'f')).terminate).toBeUndefined()
  })

  test('cancellations (aborted/timeout/dismissed) neither count nor reset', async () => {
    const cancelled: Partial<AgentToolResult> = {
      content: 'aborted',
      isError: true,
      error: { kind: 'aborted', message: 'aborted', userMessage: 'aborted' },
    }
    const [tool] = wrapToolsWithMistakeBreaker(
      [scriptedTool('bash', [fail('1'), fail('2'), fail('3'), fail('4'), cancelled, fail('5')])],
      { maxConsecutive: 5 },
    )
    for (const v of ['a', 'b', 'c', 'd']) await run(tool, v)
    expect((await run(tool, 'x')).terminate).toBeUndefined() // cancellation: not the 5th failure
    const fifth = await run(tool, 'e') // ...but it didn't reset either — this IS the 5th
    expect(fifth.terminate).toBe(true)
  })

  test('a result already carrying terminate passes through unrecorded', async () => {
    const [tool] = wrapToolsWithMistakeBreaker([
      scriptedTool('report', [{ content: 'done', isError: true, terminate: true }]),
    ])
    const result = await run(tool, 'a')
    expect(result.terminate).toBe(true)
    expect(result.content).toBe('done') // no breaker annotation on an already-ending run
    // Not latched by the passthrough: a later call still executes.
    expect((await run(tool, 'b')).content).toBe('done')
  })

  test('continue-with-notice appends guidance and grants a fresh budget', async () => {
    const [tool] = wrapToolsWithMistakeBreaker(
      [scriptedTool('bash', [fail('1'), fail('2'), fail('3'), fail('4')])],
      { maxConsecutive: 3, onLimit: () => 'continue-with-notice' },
    )
    await run(tool, 'a')
    await run(tool, 'b')
    const third = await run(tool, 'c')
    expect(third.terminate).toBeUndefined()
    expect(third.content).toContain('[guardrail] 3 consecutive failures')
    expect(third.content).toContain('counter was reset')
    // Fresh budget: the very next failure is 1/3 again, not another limit hit.
    const fourth = await run(tool, 'd')
    expect(fourth.terminate).toBeUndefined()
    expect(fourth.content).not.toContain('[guardrail]')
  })
})
