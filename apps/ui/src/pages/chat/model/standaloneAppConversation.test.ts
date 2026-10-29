import { describe, expect, test } from 'bun:test'
import { latestConversation } from './standaloneAppConversation'

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
      session('old', 'puzzle', 1),
      session('new', 'puzzle', 3),
      session('elsewhere', 'work', 9),
    ]
    expect(latestConversation(sessions, 'puzzle')).toBe('new')
  })

  test('skips archived conversations and threads, and has none in an empty project', () => {
    const sessions = [
      session('kept', 'puzzle', 1),
      session('archived', 'puzzle', 5, { isArchived: true }),
      session('thread', 'puzzle', 6, { parentSessionId: 'kept' }),
    ]
    expect(latestConversation(sessions, 'puzzle')).toBe('kept')
    expect(latestConversation(sessions, 'planner')).toBeNull()
  })
})
