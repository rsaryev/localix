import { expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'
import { createModRegistry } from '../registry'
import { createAgentApi } from './agent-api'

test('agents spawn as delegated children, from types a mod registered, and list as such', async () => {
  const tasks: Record<string, unknown>[] = []
  const delegate = {
    name: 'delegate',
    execute: async (_id: string, input: Record<string, unknown>) => {
      tasks.push(input)
      return { content: 'started', details: { tasks: [{ sessionId: `child-${tasks.length}` }] } }
    },
  } as unknown as AgentTool
  let running = false
  const registry = createModRegistry(() => {})
  const api = createAgentApi({
    instance: 'lab~1',
    registry,
    scene: () => ({ userId: 'u', sessionId: 's', cwd: '/p' }),
    surface: () => (running ? { tools: [delegate] } : undefined),
    listRuns: async () => [{ sessionId: 'child-1', taskName: 'Read', status: 'running' }],
  })

  expect(await api.spawn({ prompt: 'Read README.md.' })).toEqual({
    deny: 'Subagents start from a running turn of a conversation',
  })
  running = true
  expect(
    api.register({ name: 'runner', description: 'Runs a spec', prompt: 'You run specs.' }),
  ).toEqual({ agent: 'lab:runner' })
  expect(
    await api.spawn({ prompt: 'spec.md', description: 'run', subagentType: 'lab:runner' }),
  ).toEqual({ agentId: 'child-1', model: '' })
  expect(tasks[0]).toEqual({ task: 'You run specs.\n\nspec.md', title: 'run' })
  await api.spawn({ prompt: 'Review', subagentType: 'reviewer' })
  expect(tasks[1]).toEqual({ task: 'Review', title: 'Review', agent: 'reviewer' })
  expect(await api.list()).toEqual([
    { id: 'child-1', name: 'Read', description: 'Read', type: 'self', status: 'running' },
  ])
})
