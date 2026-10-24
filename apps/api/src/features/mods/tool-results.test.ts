import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import type { ModsApi } from '@localixai/claude-plugin/mods'
import { hostWithMod } from './testing/testing-host'

/** What `tool.call`'s `next(e)` resolves to, per tool, and what a hook's answer becomes. */

const bash = defineAgentTool({
  name: 'bash',
  description: 'bash',
  activeVerb: 'Running',
  inputSchema: z.object({ command: z.string() }),
  execute: async () => ({ content: 'hi\n' }),
}) as AgentTool

function writer(written: unknown[]) {
  return defineAgentTool({
    name: 'write',
    description: 'write',
    activeVerb: 'Writing',
    inputSchema: z.object({}).passthrough(),
    execute: async (_id, input) => {
      written.push(input)
      return { content: 'Wrote 1 file' }
    },
  }) as AgentTool
}

describe('tool.call results', () => {
  test('core answers the tool’s own record, its text and a ref; handed back, the call stands', async () => {
    const seen: unknown[] = []
    const { scope } = await hostWithMod((on) => {
      on('tool.call', async (_$, e, next) => {
        const answer = await next(e)
        seen.push(answer)
        return answer
      })
    })
    const [tool] = scope.wrapTools([bash])
    expect((await tool!.execute('t1', { command: 'echo hi' })).content).toBe('hi\n')
    expect(seen).toEqual([
      {
        result: { stdout: 'hi\n', stderr: '', interrupted: false, isImage: false },
        text: 'hi\n',
        ref: expect.any(Number),
      },
    ])
  })

  test('a hook’s own result answers the call, its context read after it', async () => {
    const { scope } = await hostWithMod((on) => {
      on('tool.call', () => ({ result: 'from the mod', context: ['A note for the model.'] }))
    })
    const [tool] = scope.wrapTools([bash])
    expect((await tool!.execute('t1', { command: 'ls' })).content).toBe(
      'from the mod\n\nA note for the model.',
    )
  })

  test('a Write of several files is one tool.call per file, each path absolute', async () => {
    const events: unknown[] = []
    const written: unknown[] = []
    const { scope, dir } = await hostWithMod((on) => {
      on('tool.call', (_$, e, next) => (events.push(e), next(e)))
    })
    const [tool] = scope.wrapTools([writer(written)])
    const files = [
      { path: 'a.md', content: 'A' },
      { path: 'b.md', content: 'B' },
    ]
    const result = await tool!.execute('w1', { files })
    expect(events).toEqual([
      { tool: 'Write', tool_use_id: 'w1', file_path: `${dir}/a.md`, content: 'A' },
      { tool: 'Write', tool_use_id: 'w1:2', file_path: `${dir}/b.md`, content: 'B' },
    ])
    expect(written).toEqual([{ files: [files[0]] }, { files: [files[1]] }])
    expect(result.content).toBe('Wrote 1 file\nWrote 1 file')
  })

  test('$.tool.call resolves the same shape as next(e) does', async () => {
    let called: unknown
    const { scope } = await hostWithMod((on) => {
      on('turn.start', async ($: ModsApi, e, next) => {
        called = await ($.tool.call as (input: unknown) => Promise<unknown>)({
          tool: 'Bash',
          command: 'echo hi',
        })
        return next(e)
      })
    })
    scope.wrapTools([bash])
    await scope.turnStart('go', 't')
    expect(called).toEqual({
      result: { stdout: 'hi\n', stderr: '', interrupted: false, isImage: false },
      text: 'hi\n',
    })
  })
})
