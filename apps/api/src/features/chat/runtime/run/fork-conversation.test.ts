import { expect, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import { copyConversationForFork } from './fork-conversation'

const row = (id: string, payload: Record<string, unknown>) =>
  ({
    id,
    sessionId: 'src',
    userId: 'u',
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    payload: { id, role: 'user', content: id, ...payload },
  }) as PersistedMessage

test('the fork copies the conversation with authors, without notices or the live turn', async () => {
  const inserted: PersistedMessage[] = []
  const repo = {
    listMessages: async () => [
      row('ask', { from: 'user' }),
      row('reply', { role: 'assistant', from: 'agent:qa', items: [{ type: 'tool_call' }] }),
      row('notice', { uiOnly: true }),
      row('live', { role: 'assistant', from: 'agent:qa' }),
    ],
    insertMessage: async (message: PersistedMessage) => void inserted.push(message),
  }
  const copied = await copyConversationForFork(repo as never, {
    userId: 'u',
    sourceSessionId: 'src',
    childSessionId: 'child',
    exclude: ['live'],
  })
  expect(copied).toBe(2)
  expect(inserted.map((message) => message.payload.content)).toEqual(['ask', 'reply'])
  expect(inserted.every((message) => message.sessionId === 'child')).toBe(true)
  expect(inserted[1]!.payload.from).toBe('agent:qa')
  expect(inserted[1]!.payload.items).toHaveLength(1)
  // Fresh ids: the child is independent of its source.
  expect(inserted.some((message) => message.id === 'ask' || message.id === 'reply')).toBe(false)
})
