import { expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { createRunApi } from './run-api'

function tool(name: string, aliases?: string[]): AgentTool {
  return {
    ...defineAgentTool({
      name,
      description: `${name} tool`,
      activeVerb: 'Running',
      inputSchema: z.object({}).passthrough(),
      execute: async (_id, input) => ({ content: `${name} got ${JSON.stringify(input)}` }),
    }),
    ...(aliases ? { aliases } : {}),
  } as AgentTool
}

test('a running turn lends its tools under Claude Code’s names; none running, a call says so', async () => {
  let surface: { tools: AgentTool[] } | undefined
  const api = createRunApi(() => surface)
  await expect(api.tool.call({ tool: 'Bash', command: 'ls' })).rejects.toThrow('No turn is running')

  surface = { tools: [tool('bash'), tool('edit'), tool('mcp_docs_search', ['mcp__docs__search'])] }
  expect(api.tool.list().map((entry) => [entry.name, entry.mcp])).toEqual([
    ['Bash', false],
    ['Edit', false],
    ['mcp__docs__search', true],
  ])
  expect(await api.tool.call({ tool: 'Bash', command: 'ls', timeout: 2000 })).toEqual({
    result: 'bash got {"command":"ls","timeout":2}',
  })
  expect(
    await api.tool.call({ tool: 'Edit', file_path: 'a', old_string: 'x', new_string: 'y' }),
  ).toEqual({ result: 'edit got {"file_path":"a","old_string":"x","new_string":"y"}' })
  expect(await api.mcp.call('docs', 'search', { q: 'hooks' })).toEqual({
    content: [{ type: 'text', text: 'mcp_docs_search got {"q":"hooks"}' }],
    isError: false,
  })
  await expect(api.mcp.call('docs', 'missing')).rejects.toThrow('No tool named mcp__docs__missing')
})

test('ui.ask puts the question to the person through the turn’s question card', async () => {
  const asked: unknown[] = []
  const ask = {
    name: 'ask',
    description: 'ask',
    execute: async (_id: string, input: unknown) => {
      asked.push(input)
      return {
        content: 'answer: Careful',
        details: { answers: [{ id: 'answer', question: 'How?', selectedOptions: ['Careful'] }] },
      }
    },
  } as unknown as AgentTool
  const api = createRunApi(() => ({ tools: [ask] }))
  expect(await api.ui.ask('How careful?', ['Bold', 'Careful'])).toBe('Careful')
  expect(asked[0]).toEqual({
    questions: [
      {
        id: 'answer',
        question: 'How careful?',
        options: [{ label: 'Bold' }, { label: 'Careful' }],
      },
    ],
  })
})
