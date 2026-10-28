import { expect, test } from 'bun:test'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { z } from 'zod'
import { createModRunScope } from './run-scope'
import { hostWithMod } from './testing/testing-host'

const tool = (name: string, mutates: boolean) =>
  defineAgentTool({
    name,
    description: name,
    activeVerb: 'Running',
    inputSchema: z.object({}).passthrough(),
    mutates,
    execute: async () => ({ content: 'ok' }),
  }) as AgentTool

async function heard(run: { agentId?: string }, facts?: { approver?: 'host' | 'person' }) {
  const seen: Record<string, unknown>[] = []
  const { host, scene } = await hostWithMod((on) => {
    on('tool.check', ($, e: any, next) => {
      seen.push(e)
      return next(e)
    })
  })
  const scope = await createModRunScope(host, scene, new Set(host.loaded()), {
    model: 'model-a',
    ...run,
  })
  scope.wrapTools([tool('read', false), tool('bash', true)])
  const port = scope.toolCheck(facts)!
  const call = (toolName: string) => ({ toolCallId: 't1', toolName, input: {} })
  await port.review!(call('read'), { decision: 'allow' })
  await port.review!(call('bash'), { decision: 'allow' })
  return seen
}

test('tool.check says what the engine knows: read-only, the loop, who answers asks', async () => {
  const [read, bash] = await heard({ agentId: 'child-1' }, { approver: 'person' })
  expect(read).toMatchObject({ isReadOnly: true, agentId: 'child-1', approver: 'person' })
  // A tool that may write is not marked: a careful hook reads the absence as a write.
  expect(bash).not.toHaveProperty('isReadOnly')
  expect(bash).toMatchObject({ agentId: 'child-1', approver: 'person' })
})

test('tool.check carries no agentId in the main loop and no approver where nobody can answer', async () => {
  const [read] = await heard({})
  expect(read).not.toHaveProperty('agentId')
  expect(read).not.toHaveProperty('approver')
})
