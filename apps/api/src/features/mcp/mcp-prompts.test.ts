import { describe, expect, test } from 'bun:test'

import { createMcpClientManager } from './client-manager'
import {
  mcpPromptCommandName,
  parsePromptArguments,
  promptInstruction,
  type McpPromptDef,
} from './mcp-prompts'
import type { McpClientLike } from './mcp-wire'
import type { McpServerRecord } from './repository'

const review: McpPromptDef = {
  name: 'code-review',
  description: 'Review code',
  arguments: [
    { name: 'file', description: 'The file', required: true },
    { name: 'focus', required: false },
  ],
}

describe('the slash command of an MCP prompt', () => {
  test('is mcp__<server>__<prompt>, with anything but letters, digits, _ and - made an underscore', () => {
    expect(mcpPromptCommandName('github', 'code-review')).toBe('mcp__github__code-review')
    expect(mcpPromptCommandName('my server', 'do.it now')).toBe('mcp__my_server__do_it_now')
    expect(mcpPromptCommandName('plugin:kit:echo', 'hi')).toBe('mcp__plugin_kit_echo__hi')
  })
})

describe('the arguments typed after the command', () => {
  test('are read in the order the prompt declares them, quotes keeping a phrase together', () => {
    expect(parsePromptArguments(review, 'src/a.ts "security and style"')).toEqual({
      values: { file: 'src/a.ts', focus: 'security and style' },
    })
  })

  test('name a missing required argument in a usage line', () => {
    const parsed = parsePromptArguments(review, '')
    expect(parsed).toHaveProperty('usage')
    expect((parsed as { usage: string }).usage).toContain('<file>')
    expect((parsed as { usage: string }).usage).toContain('[focus]')
  })

  test('beyond the declared ones are refused rather than dropped', () => {
    const parsed = parsePromptArguments(review, 'a b c')
    expect(parsed).toHaveProperty('usage')
  })

  test('a prompt with none takes none', () => {
    expect(parsePromptArguments({ name: 'hi' }, '')).toEqual({ values: {} })
    expect(parsePromptArguments({ name: 'hi' }, 'x')).toHaveProperty('usage')
  })
})

test('the messages a server returns become the instruction text, text blocks in order', () => {
  expect(
    promptInstruction({
      messages: [
        { role: 'user', content: { type: 'text', text: 'Review src/a.ts' } },
        { role: 'assistant', content: { type: 'text', text: 'Ready.' } },
        { role: 'user', content: { type: 'image', data: 'x', mimeType: 'image/png' } },
      ],
    }),
  ).toBe('Review src/a.ts\n\nAssistant: Ready.\n\n[image: image/png]')
})

const server = (name: string): McpServerRecord => ({
  id: `s-${name}`,
  userId: 'u',
  projectId: '',
  name,
  description: '',
  transport: 'stdio',
  config: { command: ['fake'] },
  createdAt: '',
  updatedAt: '',
})

function promptClient(prompts: McpPromptDef[], onGet: (args: unknown) => void): McpClientLike {
  return {
    async listTools() {
      return { tools: [] }
    },
    async callTool() {
      return { content: [] }
    },
    async close() {},
    getServerCapabilities: () => ({ prompts: {} }),
    async listPrompts() {
      return { prompts }
    },
    async getPrompt(params) {
      onGet(params)
      return { messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }] }
    },
  }
}

describe('a manager with a server that offers prompts', () => {
  test('lists the prompts of live connections without connecting, and fetches one by name', async () => {
    let connects = 0
    let asked: unknown
    const manager = createMcpClientManager({
      connect: async () => {
        connects += 1
        return promptClient([review], (a) => (asked = a))
      },
    })
    const github = server('github')
    expect(manager.cachedPrompts([github], '/tmp')).toEqual([])
    await manager.gather([github], { cwd: '/tmp', scope: 'u::/tmp' })
    const before = connects
    expect(manager.cachedPrompts([github], '/tmp')).toEqual([
      { server: 'github', serverId: 's-github', prompt: review },
    ])
    expect(connects).toBe(before)

    const result = await manager.getPrompt(github, '/tmp', 'code-review', { file: 'a.ts' })
    expect(asked).toEqual({ name: 'code-review', arguments: { file: 'a.ts' } })
    expect(promptInstruction(result)).toBe('hello')
    await manager.disposeAll()
  })

  test('a server without the prompts capability lists none', async () => {
    const manager = createMcpClientManager({
      connect: async () => ({
        ...promptClient([review], () => {}),
        getServerCapabilities: () => ({}),
      }),
    })
    const github = server('github')
    await manager.gather([github], { cwd: '/tmp', scope: 'u::/tmp' })
    expect(manager.cachedPrompts([github], '/tmp')).toEqual([])
    await manager.disposeAll()
  })
})

describe('a change of prompts', () => {
  test('is announced when a server connects with prompts and when it lists them anew', async () => {
    let announced = 0
    let notify: (() => void) | undefined
    let prompts = [review]
    const manager = createMcpClientManager({
      connect: async () => ({
        ...promptClient(prompts, () => {}),
        async listPrompts() {
          return { prompts }
        },
        setNotificationHandler(schema, handler) {
          if (schema.shape.method.value === 'notifications/prompts/list_changed') notify = handler
        },
      }),
    })
    let next: () => void = () => {}
    manager.observePrompts(() => {
      announced += 1
      next()
    })
    const github = server('github')
    await manager.gather([github], { cwd: '/tmp', scope: 'u::/tmp' })
    expect(announced).toBe(1)

    prompts = [review, { name: 'plain' }]
    const second = new Promise<void>((resolve) => (next = resolve))
    notify?.()
    await second
    expect(announced).toBe(2)
    expect(manager.cachedPrompts([github], '/tmp').map((p) => p.prompt.name)).toEqual([
      'code-review',
      'plain',
    ])
    await manager.disposeAll()
  })

  test('is announced when a connection that offered prompts closes or is disposed', async () => {
    let announced = 0
    let client: McpClientLike | undefined
    const manager = createMcpClientManager({
      connect: async () => (client = promptClient([review], () => {})),
    })
    manager.observePrompts(() => (announced += 1))
    const github = server('github')
    await manager.gather([github], { cwd: '/tmp', scope: 'u::/tmp' })
    const connected = announced

    // The transport drops: the composer must stop offering /mcp__github__code-review.
    client!.onclose?.()
    expect(announced).toBe(connected + 1)
    expect(manager.cachedPrompts([github], '/tmp')).toEqual([])

    await manager.disposeAll()
    expect(announced).toBeGreaterThan(connected + 1)
  })

  test('a server that never answers prompts/list does not fail its connection', async () => {
    const manager = createMcpClientManager({
      promptListTimeoutMs: 1,
      connect: async () => ({
        ...promptClient([review], () => {}),
        listPrompts: () => new Promise<never>(() => {}),
      }),
    })
    const github = server('github')
    // The connection is usable: prompts are listed on a best-effort, bounded call.
    expect(await manager.promptsOf(github, '/tmp')).toEqual([])
    expect(manager.cachedPrompts([github], '/tmp')).toEqual([])
    await manager.disposeAll()
  })
})
