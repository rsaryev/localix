import { expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'
import { createModRegistry } from '../registry'
import { createAgentApi } from './agent-api'

test('agents spawn as delegated children, from types a mod registered, and list as such', async () => {
  const tasks: Record<string, unknown>[] = []
  const agent = {
    name: 'Agent',
    execute: async (_id: string, input: Record<string, unknown>) => {
      tasks.push(input)
      return { content: 'started', details: { tasks: [{ sessionId: `child-${tasks.length}` }] } }
    },
  } as unknown as AgentTool
  let running = false
  const reports: string[] = []
  const registry = createModRegistry(() => {})
  const api = createAgentApi({
    plugin: 'lab',
    report: (_plugin, message) => void reports.push(message),
    instance: 'lab~1',
    registry,
    scene: () => ({ userId: 'u', sessionId: 's', cwd: '/p' }),
    surface: () => (running ? { tools: [agent] } : undefined),
    listRuns: async () => [
      { sessionId: 'child-1', taskName: 'Read', status: 'running' },
      { sessionId: 'child-2', taskName: 'Old', status: 'stopped' },
    ],
  })

  expect(await api.spawn({ prompt: 'Read README.md.' })).toEqual({
    deny: 'Subagents start from a running turn of a conversation',
  })
  running = true
  expect(
    await api.register({
      name: 'runner',
      description: 'Runs a spec',
      prompt: 'You run specs.',
      tools: ['Read'],
      initialPrompt: 'Run this spec: {{intent}}',
      permissionMode: 'plan',
    }),
  ).toEqual({ agent: 'lab:runner' })
  // The fields stay on the definition the agent catalog lists (`registry.agentGroups`).
  expect(registry.agentGroups()).toMatchObject([
    {
      plugin: 'lab',
      agents: [{ fullName: 'lab:runner', prompt: 'You run specs.', tools: ['Read'] }],
    },
  ])
  expect(reports).toEqual([
    "agent.register: permissionMode of lab:runner are kept and not applied: Claude Code leaves them out of a plugin's agent",
  ])
  await expect(
    api.register({ name: 'bad', description: 'd', prompt: 'p', maxTurns: 0 }),
  ).rejects.toThrow()
  expect(
    await api.spawn({ prompt: 'spec.md', description: 'run', subagentType: 'lab:runner' }),
  ).toEqual({ agentId: 'child-1', model: '' })
  // The agent runs as its definition, not as a prompt in front of the task.
  expect(tasks[0]).toEqual({
    prompt: 'Run this spec: spec.md',
    description: 'run',
    subagent_type: 'lab:runner',
  })
  await api.spawn({ prompt: 'x.md', name: 'scout', subagentType: 'lab:runner' })
  expect(tasks[1]).toMatchObject({ description: 'scout', subagent_type: 'lab:runner' })
  await api.spawn({ prompt: 'Review', subagentType: 'reviewer' })
  expect(tasks[2]).toEqual({ prompt: 'Review', description: 'Review', subagent_type: 'reviewer' })
  expect(await api.list()).toEqual([
    { id: 'child-1', name: 'Read', description: 'Read', type: 'self', status: 'running' },
    // Claude Code's word for a stopped agent.
    { id: 'child-2', name: 'Old', description: 'Old', type: 'self', status: 'killed' },
  ])
})
