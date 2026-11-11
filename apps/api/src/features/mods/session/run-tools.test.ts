import { expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { createRunTools, type RunSurface } from './run-tools'

/** What a conversation's running turn lends its mods: its tools, its verdict, its question card. */

const signal = new AbortController().signal

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

function runTools(surface: () => RunSurface | undefined, agentType = () => undefined) {
  return createRunTools({ surface, cwd: '/p', agentType })
}

test('a running turn lends its tools under Claude Code’s names; none running, a call says so', async () => {
  let surface: RunSurface | undefined
  const run = runTools(() => surface)
  await expect(run.tools.call({ tool: 'Bash', command: 'ls' }, signal)).rejects.toThrow(
    'No turn is running',
  )
  surface = { tools: [tool('Bash'), tool('Edit'), tool('Search')] }
  expect(
    await run.tools.call({ tool: 'Bash', command: 'ls', timeout: 2000 }, signal),
  ).toMatchObject({
    result: { stdout: 'Bash got {"command":"ls","timeout":2}', stderr: '' },
    text: 'Bash got {"command":"ls","timeout":2}',
  })
  expect(
    await run.tools.call(
      { tool: 'Edit', file_path: 'a', old_string: 'x', new_string: 'y' },
      signal,
    ),
  ).toMatchObject({ text: 'Edit got {"edits":[{"path":"a","old_string":"x","new_string":"y"}]}' })
  expect(await run.tools.call({ tool: 'Glob', pattern: '*.ts' }, signal)).toMatchObject({
    text: expect.stringContaining('Search got'),
  })
})

test('$.tool.call of a call the gate refuses does not run: the refusal is the answer', async () => {
  let ran = 0
  const gated = {
    ...tool('Bash'),
    execute: async () => {
      ran++
      throw Object.assign(new Error('Blocked by the Claude Code permission rule Bash(rm:*)'), {
        blocked: true,
      })
    },
  } as AgentTool
  const run = runTools(() => ({ tools: [gated] }))
  await expect(run.tools.call({ tool: 'Bash', command: 'rm -rf /' }, signal)).rejects.toThrow(
    'Blocked by the Claude Code permission rule',
  )
  expect(ran).toBe(1)
})

test('$.tool.check answers the turn’s verdict; a denied call reads as denied', async () => {
  const run = runTools(() => ({
    tools: [tool('Bash')],
    verdict: (name, input) =>
      name === 'Bash' && String((input as { command?: unknown }).command).startsWith('rm')
        ? { decision: 'deny', reason: 'rule', rule: 'Bash(rm:*)' }
        : { decision: 'allow' },
  }))
  expect(await run.tools.check({ tool: 'Bash', input: { command: 'rm x' } }, signal)).toEqual({
    decision: 'deny',
    reason: 'rule',
    rule: 'Bash(rm:*)',
  })
  expect(await run.tools.check({ tool: 'Bash', input: { command: 'ls' } }, signal)).toEqual({
    decision: 'allow',
  })
})

test('$.mcp.call runs the turn’s MCP tool, which the gate guards as any other', async () => {
  const refused = {
    ...tool('mcp_docs_drop', ['mcp__docs__drop']),
    execute: async () => {
      throw new Error('Blocked by the Claude Code permission rule mcp__docs__drop')
    },
  } as AgentTool
  const run = runTools(() => ({ tools: [tool('mcp_docs_search', ['mcp__docs__search']), refused] }))
  expect(await run.mcp.ensureConnected('docs', 0, signal)).toBe('connected')
  expect(await run.mcp.ensureConnected('other', 0, signal)).toBe('unavailable')
  expect(
    await run.mcp.callTool({ server: 'docs', tool: 'search', input: { q: 1 }, signal }),
  ).toEqual({ isError: false, text: 'mcp_docs_search got {"q":1}' })
  await expect(
    run.mcp.callTool({ server: 'docs', tool: 'drop', input: {}, signal }),
  ).rejects.toThrow('Blocked')
})

test('$.ui.ask puts the question to the person through the turn’s question card', async () => {
  const asked: unknown[] = []
  const ask = {
    name: 'AskUserQuestion',
    description: 'ask',
    execute: async (_id: string, input: unknown) => {
      asked.push(input)
      return {
        content: 'answer: Careful',
        details: { answers: [{ id: 'answer', question: 'How?', selectedOptions: ['Careful'] }] },
      }
    },
  } as unknown as AgentTool
  const run = runTools(() => ({ tools: [ask] }))
  expect(await run.ask({ question: 'How careful?', options: ['Bold', 'Careful'] })).toBe('Careful')
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

test('agents spawn through the turn’s Agent tool, from a type a mod registered', async () => {
  const tasks: Record<string, unknown>[] = []
  const agent = {
    name: 'Agent',
    execute: async (_id: string, input: Record<string, unknown>) => {
      tasks.push(input)
      return { content: 'started', details: { tasks: [{ sessionId: `child-${tasks.length}` }] } }
    },
  } as unknown as AgentTool
  let running = false
  const run = createRunTools({
    surface: () => (running ? { tools: [agent] } : undefined),
    cwd: '/p',
    agentType: (name) =>
      name === 'runner' ? { initialPrompt: 'Run this spec: {{intent}}' } : undefined,
  })
  expect(await run.spawn({ prompt: 'Read README.md.' })).toEqual({
    deny: 'Subagents start from a running turn of a conversation',
  })
  running = true
  expect(
    await run.spawn({ prompt: 'spec.md', description: 'run', subagentType: 'runner' }),
  ).toEqual({ agentId: 'child-1', model: '' })
  expect(tasks[0]).toEqual({
    prompt: 'Run this spec: spec.md',
    description: 'run',
    subagent_type: 'runner',
  })
  await run.spawn({ prompt: 'Review', subagentType: 'reviewer' })
  expect(tasks[1]).toEqual({ prompt: 'Review', description: 'Review', subagent_type: 'reviewer' })
})

test('a refused spawn — the gate or the rules — answers its deny', async () => {
  const agent = {
    name: 'Agent',
    execute: async () => ({ content: 'Agent type denied by Agent(Explore)', isError: true }),
  } as unknown as AgentTool
  const run = runTools(() => ({ tools: [agent] }))
  expect(await run.spawn({ prompt: 'p', subagentType: 'Explore' })).toEqual({
    deny: 'Agent type denied by Agent(Explore)',
  })
})
