/**
 * The host's `afterToolBatch`: asked once every call of a response has settled, before the next
 * request, with each call and the result the model will read. Its messages reach that request;
 * its stop ends the run there.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import type { ToolBatchContext } from '@localixai/agent/runtime'

import { collect, say, scriptedSession } from './__fixtures__/scripted-session'
import { runAgentLoop } from './index'
import type { LoopInput } from './loop'

const echo = defineAgentTool({
  name: 'echo',
  description: 'echo',
  activeVerb: 'Echoing',
  inputSchema: z.object({ id: z.string() }),
  async execute(_id, input) {
    return { content: `echoed ${(input as { id: string }).id}` }
  },
}) as AgentTool

function start(afterToolBatch: LoopInput['afterToolBatch']) {
  const { session, requests } = scriptedSession([
    {
      calls: [
        { name: 'echo', arguments: { id: 'a' } },
        { name: 'echo', arguments: { id: 'b' } },
      ],
    },
    say('done'),
  ])
  const run = runAgentLoop({
    sessionId: 's',
    systemPrompt: 'p',
    messages: [{ role: 'user', content: 'go', timestamp: 0 }],
    session,
    tools: [echo],
    afterToolBatch,
  })
  return { run, requests }
}

describe('afterToolBatch', () => {
  test('sees the whole batch once, and its messages reach the next request', async () => {
    const batches: ToolBatchContext[] = []
    const { run, requests } = start(async (batch) => {
      batches.push(batch)
      return { messages: [{ role: 'user', content: 'run the tests next', timestamp: 1 }] }
    })
    const { result } = await collect(run)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.calls.map((c) => [c.toolName, c.input, c.result.content])).toEqual([
      ['echo', { id: 'a' }, 'echoed a'],
      ['echo', { id: 'b' }, 'echoed b'],
    ])
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1]!.messages)).toContain('run the tests next')
    expect(result).toMatchObject({ terminal: 'completed' })
  })

  test('a stop ends the run before the next request, named as what stopped it', async () => {
    const { run, requests } = start(async () => ({ stop: 'batchHook' }))
    const { result } = await collect(run)
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ terminal: 'completed', stoppedBy: 'batchHook' })
  })
})
