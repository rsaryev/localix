import { expect, test } from 'bun:test'

import type { McpPromptDef } from '../../mcp/mcp-prompts'
import type { McpServerRecord } from '../../mcp/repository'
import {
  isMcpPromptToken,
  resolveMcpPromptCommand,
  type McpPromptPorts,
} from './command-handlers-mcp-prompt'

const server = (name: string): McpServerRecord => ({
  id: `claude-code:user:${name}`,
  userId: 'u',
  projectId: '',
  name,
  description: '',
  transport: 'stdio',
  config: {},
  createdAt: '',
  updatedAt: '',
})

const review: McpPromptDef = {
  name: 'code-review',
  arguments: [{ name: 'file', required: true }, { name: 'focus' }],
}

function ports(over: Partial<McpPromptPorts> = {}) {
  const asked: unknown[] = []
  const p: McpPromptPorts = {
    servers: async () => [server('github'), server('git hub')],
    enabled: () => true,
    prompts: async () => [review, { name: 'plain' }],
    getPrompt: async (_server, name, args) => {
      asked.push({ name, args })
      return { messages: [{ role: 'user', content: { type: 'text', text: `do ${name}` } }] }
    },
    ...over,
  }
  return { p, asked }
}

test('only a token shaped mcp__<server>__<prompt> is an MCP prompt command', () => {
  expect(isMcpPromptToken('/mcp__github__code-review')).toBe(true)
  expect(isMcpPromptToken('/MCP__github__x')).toBe(true)
  expect(isMcpPromptToken('/mcp')).toBe(false)
  expect(isMcpPromptToken('/mcp__github')).toBe(false)
  expect(isMcpPromptToken('/plugin:cmd')).toBe(false)
})

test('a typed prompt command fetches the prompt with its arguments and returns the turn', async () => {
  const { p, asked } = ports()
  const result = await resolveMcpPromptCommand(
    p,
    '/mcp__github__code-review',
    'src/a.ts "all of it"',
  )
  expect(result).toEqual({ kind: 'run', instruction: 'do code-review' })
  expect(asked).toEqual([{ name: 'code-review', args: { file: 'src/a.ts', focus: 'all of it' } }])
})

test('the server is found by its normalized name, a prompt with no arguments takes none', async () => {
  const { p, asked } = ports()
  expect(await resolveMcpPromptCommand(p, '/mcp__git_hub__plain', '')).toMatchObject({
    kind: 'run',
  })
  expect(asked).toEqual([{ name: 'plain', args: {} }])
})

test('a missing required argument answers with the usage and fetches nothing', async () => {
  const { p, asked } = ports()
  const result = await resolveMcpPromptCommand(p, '/mcp__github__code-review', '')
  expect(result).toMatchObject({ kind: 'reply', tone: 'warning' })
  expect((result as { text: string }).text).toContain('/mcp__github__code-review <file> [focus]')
  expect(asked).toEqual([])
})

test('an unknown server or prompt, a disabled server, and a server that fails each say so', async () => {
  const unknownServer = await resolveMcpPromptCommand(ports().p, '/mcp__nope__x', '')
  expect(unknownServer).toMatchObject({ kind: 'reply', tone: 'error' })
  expect((unknownServer as { text: string }).text).toContain('No MCP server')

  const unknownPrompt = await resolveMcpPromptCommand(ports().p, '/mcp__github__nope', '')
  expect((unknownPrompt as { text: string }).text).toContain('code-review')

  const off = await resolveMcpPromptCommand(
    ports({ enabled: () => false }).p,
    '/mcp__github__plain',
    '',
  )
  expect((off as { text: string }).text).toContain('disabled')

  const down = await resolveMcpPromptCommand(
    ports({
      prompts: async () => {
        throw new Error('spawn ENOENT')
      },
    }).p,
    '/mcp__github__plain',
    '',
  )
  expect((down as { text: string }).text).toContain('spawn ENOENT')
})

test('a prompt that returns no text is reported, not sent as an empty turn', async () => {
  const { p } = ports({ getPrompt: async () => ({ messages: [] }) })
  expect(await resolveMcpPromptCommand(p, '/mcp__github__plain', '')).toMatchObject({
    kind: 'reply',
  })
})

test('a name two servers spell alike goes to the one that has the prompt, longest name first', async () => {
  // `a` + `b__c` and `a__b` + `c` are both /mcp__a__b__c.
  const fetchedFrom: string[] = []
  const offered: Record<string, McpPromptDef[]> = {
    a: [{ name: 'b__c' }],
    a__b: [{ name: 'other' }],
  }
  const { p } = ports({
    servers: async () => [server('a'), server('a__b')],
    prompts: async (s) => offered[s.name] ?? [],
    getPrompt: async (s, name) => {
      fetchedFrom.push(`${s.name}:${name}`)
      return { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] }
    },
  })
  expect(await resolveMcpPromptCommand(p, '/mcp__a__b__c', '')).toEqual({
    kind: 'run',
    instruction: 'hi',
  })
  expect(fetchedFrom).toEqual(['a:b__c'])

  // When both have it, the longer server name wins.
  offered.a__b = [{ name: 'c' }]
  fetchedFrom.length = 0
  await resolveMcpPromptCommand(p, '/mcp__a__b__c', '')
  expect(fetchedFrom).toEqual(['a__b:c'])

  // When neither has it, the answer names the longest.
  offered.a__b = []
  offered.a = []
  expect(await resolveMcpPromptCommand(p, '/mcp__a__b__c', '')).toMatchObject({
    kind: 'reply',
    text: expect.stringContaining('`a__b` has no prompt'),
  })
})
