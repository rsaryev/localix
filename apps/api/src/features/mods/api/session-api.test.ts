import { expect, test } from 'bun:test'
import type { ModSessionRead } from '../contracts'
import { createSessionApi } from './session-api'

const main: ModSessionRead = {
  model: 'm',
  messages: [
    { role: 'user', text: 'Read it', toolUses: [] },
    {
      role: 'assistant',
      text: 'Reading.',
      toolUses: [
        { tool_use_id: 'tu1', tool: 'Read', input: { file_path: '/a' }, result: {}, text: 'body' },
      ],
      toolResults: [{ tool_use_id: 'tu1', text: 'body', isError: false }],
    },
    { role: 'assistant', text: 'Done.', toolUses: [] },
  ],
}
const child: ModSessionRead = {
  model: 'c',
  messages: [{ role: 'user', text: 'Child task', toolUses: [] }],
}

function api(scene = { userId: 'u', sessionId: 's1' as string | undefined, cwd: '/p' }) {
  const read: string[] = []
  return {
    read,
    api: createSessionApi({
      scene: () => scene,
      ports: {
        readSession: async (asked) => {
          read.push(asked.sessionId ?? '')
          return asked.sessionId === 'child-1' ? child : main
        },
      },
      agentIds: async () => ['child-1'],
      append: () => {},
      run: async () => ({ exitCode: 1, stdout: '' }),
      compact: async () => null,
    }),
  }
}

test('messages({ agentId }) reads that agent’s conversation, or says why not', async () => {
  const { api: session, read } = api()
  expect(await session.messages({ agentId: 'child-1' })).toEqual(child.messages)
  expect(read).toEqual(['child-1'])
  expect(await session.messages({ agentId: 'ghost' })).toEqual({
    deny: 'No agent ghost in this conversation to read',
  })
})

test('messages({ as: "api" }) gives the Messages API form: blocks, results paired in the next user message', async () => {
  const { api: session } = api()
  expect(await session.messages({ as: 'api' })).toEqual([
    { role: 'user', content: [{ type: 'text', text: 'Read it' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading.' },
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'body', is_error: false }],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  ])
  expect(await session.messages({ as: 'api', agentId: 'child-1' })).toEqual([
    { role: 'user', content: [{ type: 'text', text: 'Child task' }] },
  ])
})

test('the newest 4096 messages, the form opening on a user message', async () => {
  const many: ModSessionRead = {
    model: 'm',
    messages: Array.from({ length: 5000 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `m${i}`,
      toolUses: [],
    })),
  }
  const session = createSessionApi({
    scene: () => ({ userId: 'u', sessionId: 's1', cwd: '/p' }),
    ports: { readSession: async () => many },
    agentIds: async () => [],
    append: () => {},
    run: async () => ({ exitCode: 1, stdout: '' }),
    compact: async () => null,
  })
  const rows = (await session.messages()) as { text: string }[]
  expect(rows).toHaveLength(4096)
  expect(rows.at(-1)!.text).toBe('m4999')
  const api = (await session.messages({ as: 'api' })) as { role: string }[]
  expect(api.length).toBeLessThanOrEqual(4096)
  expect(api[0]!.role).toBe('user')
})

test('id() names the conversation and rejects where there is none', async () => {
  expect(await api().api.id()).toBe('s1')
  await expect(api({ userId: 'u', sessionId: undefined, cwd: '/p' }).api.id()).rejects.toThrow(
    'no conversation',
  )
})

test('repo() names no repository Localix treats as its own', async () => {
  const session = createSessionApi({
    scene: () => ({ userId: 'u', sessionId: 's1', cwd: '/p' }),
    ports: {},
    agentIds: async () => [],
    append: () => {},
    run: async (argv) => ({
      exitCode: 0,
      stdout: argv.includes('--show-toplevel') ? '/p\n' : 'git@x:o/r.git\n',
    }),
    compact: async () => null,
  })
  expect(await session.repo()).toEqual({
    root: '/p',
    remote: 'git@x:o/r.git',
    internal: false,
    name: null,
  })
})

test('messages({ as: "api" }) skips a row with nothing to send: the API rejects empty content', async () => {
  const empty: ModSessionRead = {
    model: 'm',
    messages: [
      { role: 'user', text: 'Hi', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [] },
      { role: 'user', text: '', toolUses: [] },
      { role: 'assistant', text: 'Hello', toolUses: [] },
    ],
  }
  const session = createSessionApi({
    scene: () => ({ userId: 'u', sessionId: 's1', cwd: '/p' }),
    ports: { readSession: async () => empty },
    agentIds: async () => [],
    append: () => {},
    run: async () => ({ exitCode: 1, stdout: '' }),
    compact: async () => null,
  })
  expect(await session.messages({ as: 'api' })).toEqual([
    { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
  ])
})
