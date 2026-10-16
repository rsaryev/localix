import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { wrapToolsWithStuckRunBreaker } from './stuck-run-breaker'

function tool(
  name: string,
  run: (input: { v: string }) => AgentToolResult | Promise<AgentToolResult>,
  hints?: AgentTool['behaviorHints'],
): AgentTool {
  return {
    name,
    description: name,
    inputSchema: z.object({ v: z.string() }),
    activeVerb: 'Testing',
    ...(hints ? { behaviorHints: hints } : {}),
    execute: async (_id, input) => run(input as { v: string }),
  } as AgentTool
}

const fail = (content: string): AgentToolResult => ({ content, isError: true })
const ok = (content = 'ok'): AgentToolResult => ({ content })

describe('stuck run breaker', () => {
  test('adds nothing to a result before a limit is reached', async () => {
    const [edit] = wrapToolsWithStuckRunBreaker([tool('edit', () => fail('old_string not found'))])
    for (let i = 0; i < 3; i++) {
      expect(await edit!.execute('c', { v: 'same' })).toEqual(fail('old_string not found'))
    }
  })

  test('stops when the same call fails the same way four times in a row', async () => {
    const [edit, read] = wrapToolsWithStuckRunBreaker([
      tool('edit', () => fail('old_string not found')),
      tool('read', () => ok()),
    ])
    for (let i = 0; i < 3; i++) await edit!.execute('c', { v: 'same' })
    const fourth = await edit!.execute('c', { v: 'same' })
    expect(fourth.terminate).toBe(true)
    expect(fourth.content).toContain('failed the same way 4 times in a row')
    // Latched: nothing else runs this run.
    const after = await read!.execute('c', { v: 'x' })
    expect(after.terminate).toBe(true)
    expect(after.content).toContain('This call was not executed')
  })

  test('a call whose failure changes each time is progress, not a stuck repeat', async () => {
    let n = 0
    const [build] = wrapToolsWithStuckRunBreaker(
      [tool('build', () => fail(`${5 - n++} errors left`))],
      {
        sameFailure: 4,
        consecutiveFailures: 99,
        identicalCalls: 99,
      },
    )
    for (let i = 0; i < 5; i++) {
      expect((await build!.execute('c', { v: 'same' })).terminate).toBeUndefined()
    }
  })

  test('stops after six varied failures with no success between; a success resets', async () => {
    const [bash] = wrapToolsWithStuckRunBreaker([
      tool('bash', ({ v }) => (v === 'good' ? ok() : fail(`exit 1: ${v}`))),
    ])
    for (const v of ['a', 'b', 'c', 'd', 'e']) await bash!.execute('c', { v })
    await bash!.execute('c', { v: 'good' })
    for (const v of ['f', 'g', 'h', 'i', 'j']) {
      expect((await bash!.execute('c', { v })).terminate).toBeUndefined()
    }
    const sixth = await bash!.execute('c', { v: 'k' })
    expect(sixth.terminate).toBe(true)
    expect(sixth.content).toContain('6 tool calls failed in a row')
  })

  test('stops a call repeated eight times in a row even when it succeeds', async () => {
    const [read] = wrapToolsWithStuckRunBreaker([tool('read', () => ok('same file'))])
    for (let i = 0; i < 7; i++) {
      expect((await read!.execute('c', { v: 'a.ts' })).terminate).toBeUndefined()
    }
    expect((await read!.execute('c', { v: 'a.ts' })).content).toContain('issued 8 times in a row')
  })

  test('a tool whose every call has its own effect repeats freely while its answers change', async () => {
    let board = 0
    const [move] = wrapToolsWithStuckRunBreaker([
      tool('move', () => ok(`board ${board++}`), { idempotentHint: false }),
    ])
    for (let i = 0; i < 12; i++) {
      expect((await move!.execute('c', { v: 'left' })).terminate).toBeUndefined()
    }
  })

  test('cancellations neither count nor reset, and a throw counts as a failure', async () => {
    const aborted: AgentToolResult = {
      content: 'aborted',
      isError: true,
      error: { kind: 'aborted' } as never,
    }
    const [ask, bash] = wrapToolsWithStuckRunBreaker(
      [
        tool('ask', () => aborted),
        tool('bash', () => {
          throw new Error('spawn failed')
        }),
      ],
      { sameFailure: 99, consecutiveFailures: 3, identicalCalls: 99 },
    )
    await bash!.execute('c', { v: '1' })
    await ask!.execute('c', { v: 'q' })
    await bash!.execute('c', { v: '2' })
    const third = await bash!.execute('c', { v: '3' })
    expect(third.isError).toBe(true)
    expect(third.terminate).toBe(true)
  })
})
