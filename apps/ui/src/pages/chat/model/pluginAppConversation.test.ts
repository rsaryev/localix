import { describe, expect, test } from 'bun:test'
import { latestConversation } from './pluginAppConversation'

const session = (id: string, projectId: string, updatedAt: number, extra = {}) => ({
  id,
  projectId,
  parentSessionId: null,
  isArchived: false,
  updatedAt,
  ...extra,
})

describe('latestConversation', () => {
  test("opens on the newest of the app's own conversations", () => {
    const sessions = [
      session('old', 'chess', 1),
      session('new', 'chess', 3),
      session('elsewhere', 'work', 9),
    ]
    expect(latestConversation(sessions, 'chess')).toBe('new')
  })

  test('skips archived conversations and threads, and has none in an empty project', () => {
    const sessions = [
      session('kept', 'chess', 1),
      session('archived', 'chess', 5, { isArchived: true }),
      session('thread', 'chess', 6, { parentSessionId: 'kept' }),
    ]
    expect(latestConversation(sessions, 'chess')).toBe('kept')
    expect(latestConversation(sessions, 'kanban')).toBeNull()
  })
})
