import { describe, expect, test } from 'bun:test'

import { toImportSessionRequest } from './client'

describe('external session import wire body', () => {
  test('drops UI message ids and presentation-only fields before the strict API boundary', () => {
    const request = toImportSessionRequest({
      title: 'External session',
      messages: [
        {
          id: 'foreign#turn-0',
          role: 'user',
          content: 'Fix the parser',
          usage: { totalTokens: 42 },
        },
        {
          id: 'foreign#turn-1',
          role: 'assistant',
          items: [{ id: 'text-1', type: 'text', status: 'completed', text: 'Done.' }],
        },
      ],
    } as unknown as Parameters<typeof toImportSessionRequest>[0])

    expect(request).toEqual({
      title: 'External session',
      messages: [
        { role: 'user', content: 'Fix the parser' },
        {
          role: 'assistant',
          items: [{ id: 'text-1', type: 'text', status: 'completed', text: 'Done.' }],
        },
      ],
    })
    expect(request.messages.every((message) => !('id' in message))).toBe(true)
  })
})
