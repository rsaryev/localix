import { expect, test } from 'bun:test'
import type { PersistedMessage } from '../features/chat/contracts'
import { sessionReadOf } from './mods-session'

const message = (id: string, payload: Record<string, unknown>) =>
  ({ id, sessionId: 's', userId: 'u', payload: { id, ...payload } }) as unknown as PersistedMessage

test('a conversation reads as Claude Code’s $.session gives it', () => {
  const read = sessionReadOf(
    [
      message('1', { role: 'user', content: 'List the files' }),
      message('2', { role: 'user', content: 'a wake prompt', isInternal: true }),
      message('3', {
        role: 'assistant',
        content: 'Two files.',
        items: [
          { type: 'text', id: 't', status: 'completed', text: 'Two files.' },
          {
            type: 'command',
            id: 'c',
            status: 'completed',
            toolCallId: 'call-1',
            name: 'bash',
            input: { command: 'ls' },
            command: 'ls',
            resultText: 'a\nb',
          },
          { type: 'tool_call', id: 'f', status: 'failed', toolCallId: 'call-2', name: 'read' },
        ],
        usage: { totalCost: 0.25 },
        dataParts: [
          {
            type: 'data-context-window',
            data: { fullWindowTokens: 200_000, activeTokens: 50_000 },
          },
        ],
      }),
      message('4', { role: 'assistant', content: 'More.', usage: { totalCost: 0.5 } }),
    ],
    'claude-opus',
  )

  expect(read.model).toBe('claude-opus')
  expect(read.messages.map((entry) => entry.text)).toEqual([
    'List the files',
    'Two files.',
    'More.',
  ])
  expect(read.messages[1]).toEqual({
    role: 'assistant',
    text: 'Two files.',
    toolUses: [
      { tool_use_id: 'call-1', tool: 'bash', input: { command: 'ls' } },
      { tool_use_id: 'call-2', tool: 'read', input: {} },
    ],
    toolResults: [
      { tool_use_id: 'call-1', text: 'a\nb', isError: false },
      { tool_use_id: 'call-2', text: '', isError: true },
    ],
  })
  expect(read.context).toEqual({ window: 200_000, tokens: 50_000 })
  expect(read.costUsd).toBe(0.75)
})

test('a conversation with no measurement leaves the figures out', () => {
  const read = sessionReadOf([message('1', { role: 'user', content: 'hi' })], null)
  expect(read).toEqual({
    messages: [{ role: 'user', text: 'hi', toolUses: [] }],
    model: null,
  })
})
