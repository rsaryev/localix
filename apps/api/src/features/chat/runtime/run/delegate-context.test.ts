import { expect, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import { copyConversationForDelegate } from './delegate-context'

const row = (id: string, payload: Record<string, unknown>) =>
  ({
    id,
    sessionId: 'src',
    userId: 'u',
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    payload: { id, role: 'user', content: id, ...payload },
  }) as PersistedMessage

async function copy(rows: PersistedMessage[], exclude: string[] = []) {
  const inserted: PersistedMessage[] = []
  const repo = {
    listMessages: async () => rows,
    insertMessage: async (message: PersistedMessage) => void inserted.push(message),
  }
  const copied = await copyConversationForDelegate(repo as never, {
    userId: 'u',
    sourceSessionId: 'src',
    childSessionId: 'child',
    delegatingAgentId: 'builtin:qa',
    exclude,
  })
  return { copied, inserted }
}

test('the child carries what the person and the delegator said, and nothing else', async () => {
  const { copied, inserted } = await copy(
    [
      row('ask', { from: 'user' }),
      row('reply', {
        role: 'assistant',
        from: 'agent:builtin:qa',
        items: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'tool_call', toolCallId: 't1', name: 'read' },
          { type: 'text', text: 'Found it.' },
        ],
        dataParts: [{ type: 'data-usage', data: {} }],
      }),
      row('colleague', {
        role: 'assistant',
        from: 'agent:native:design',
        items: [{ type: 'text' }],
      }),
      row('wake', { from: 'system' }),
      row('notice', { from: 'user', uiOnly: true }),
      row('live', { role: 'assistant', from: 'agent:builtin:qa', items: [{ type: 'text' }] }),
    ],
    ['live'],
  )
  expect(copied).toBe(2)
  expect(inserted.map((message) => message.payload.content)).toEqual(['ask', 'reply'])
  expect(inserted.every((message) => message.sessionId === 'child')).toBe(true)
  expect(inserted[1]!.payload.from).toBe('agent:builtin:qa')
  expect(inserted[1]!.payload.items).toEqual([{ type: 'text', text: 'Found it.' } as never])
  expect(inserted[1]!.payload.dataParts).toBeUndefined()
  // Fresh ids: the child is independent of its source.
  expect(inserted.some((message) => message.id === 'ask' || message.id === 'reply')).toBe(false)
})

test("a command's instruction stays with its own turn; attachments travel", async () => {
  const invocation = { kind: 'invocation', id: 'i', instruction: 'Lead a team to this goal' }
  const attachment = { kind: 'image', id: 'a', name: 'shot.png' }
  const { inserted } = await copy([
    row('cmd', { from: 'user', content: '/workflows 2048', bindings: [invocation] }),
    row('pic', { from: 'user', content: 'see this', bindings: [invocation, attachment] }),
  ])
  expect(inserted[0]!.payload.bindings).toBeUndefined()
  expect(inserted[1]!.payload.bindings).toEqual([attachment as never])
})
