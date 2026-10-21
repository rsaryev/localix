import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { recentsKey } from './useDockRecents'

const chat = (id: string, updatedAt: number, title = id) =>
  ({ id, title, updatedAt, messages: [], queuedMessages: [] }) as unknown as UiSession

describe('recentsKey', () => {
  test('lists titled top-level chats newest first, skipping drafts and archives', () => {
    const sessions = [
      chat('a', 1),
      chat('b', 3),
      chat('draft', 4, ' '),
      { ...chat('old', 5), isArchived: true } as UiSession,
    ]
    expect(JSON.parse(recentsKey(sessions))).toEqual([
      { id: 'b', title: 'b' },
      { id: 'a', title: 'a' },
    ])
  })

  test('recomputes only when the session list is replaced', () => {
    const sessions = [chat('a', 1)]
    const first = recentsKey(sessions)
    // Mutating in place is not how the store changes; a stale key here proves the memo held.
    sessions.push(chat('b', 2))
    expect(recentsKey(sessions)).toBe(first)
    expect(JSON.parse(recentsKey([...sessions]))).toHaveLength(2)
  })
})
