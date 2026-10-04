import { describe, expect, test } from 'bun:test'
import chatSurface from './ChatSurface.surface'

describe('Chat work-item surface', () => {
  test('opens an exact chat session through a typed Localix location', () => {
    expect(chatSurface.uri).toBe('localix://ui/work-item/chat')
    expect(chatSurface.resolve({ session: 'session-7' })).toEqual({
      kind: 'session',
      sessionId: 'session-7',
    })
  })
})
