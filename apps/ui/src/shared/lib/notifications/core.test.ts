import { describe, expect, it } from 'bun:test'
import { addEntry, markAllRead, markRead, removeEntry, unreadCount } from './core'
import type { NotificationEntry } from './types'

function entry(id: string, read = false): NotificationEntry {
  return {
    id,
    topic: 'application.notification',
    category: 'system',
    severity: 'info',
    title: id,
    origin: { kind: 'application' },
    ts: Number(id) || 0,
    read,
  }
}

describe('notifications/core', () => {
  it('prepends newest-first', () => {
    const list = addEntry(addEntry([], entry('a')), entry('b'))
    expect(list.map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('caps at the limit and drops the oldest', () => {
    let list: NotificationEntry[] = []
    for (let i = 0; i < 5; i++) list = addEntry(list, entry(String(i)), 3)
    // newest-first, only the last 3 pushed survive
    expect(list.map((n) => n.id)).toEqual(['4', '3', '2'])
    expect(list).toHaveLength(3)
  })

  it('makes room by dropping the oldest settled row, never an open problem', () => {
    const open = { ...entry('application.condition:db:x:1'), condition: true }
    let list: NotificationEntry[] = [open]
    for (let i = 0; i < 4; i++) list = addEntry(list, entry(`noise-${i}`), 3)
    // Four rows of noise arrived after the problem; the problem is still here, the oldest noise is not.
    expect(list.map((n) => n.id)).toEqual(['noise-3', 'noise-2', open.id])
  })

  it('deduplicates a replayed durable id without resetting its read state', () => {
    const existing = entry('trg:t1:1', true)
    const list = [existing]
    const replay = { ...existing, read: false, title: 'replayed' }
    expect(addEntry(list, replay)).toBe(list)
    expect(addEntry(list, replay)[0]).toEqual(existing)
  })

  it('reopens a settled condition that is published again, but never a settled request', () => {
    const condition = {
      ...entry('application.condition:db:board.json:abc', true),
      condition: true,
      resolvedAt: 50,
    }
    const back = { ...entry('application.condition:db:board.json:abc'), condition: true }
    const reopened = addEntry([entry('other'), condition], back)
    // The problem is true again: live, unread, and on top — not still wearing "Resolved".
    expect(reopened.map((n) => n.id)).toEqual([back.id, 'other'])
    expect(reopened[0]?.resolvedAt).toBeUndefined()
    expect(reopened[0]?.read).toBe(false)
    expect(reopened[0]?.occurrenceCount).toBe(2)

    const answered = { ...entry('hitl:s1:r1', true), resolvedAt: 50 }
    const list = [answered]
    expect(addEntry(list, entry('hitl:s1:r1'))).toBe(list)
  })

  it('quietly coalesces repeated application events and preserves unread state', () => {
    const first = {
      ...entry('first', true),
      title: 'Extension failed',
      message: 'Connection lost',
      ts: 1_000,
    }
    const repeated = {
      ...entry('second'),
      title: 'Extension failed',
      message: 'Connection lost',
      ts: 2_000,
    }
    const list = addEntry([first], repeated)

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'first',
      occurrenceCount: 2,
      firstSeenAt: 1_000,
      lastSeenAt: 2_000,
      ts: 2_000,
      read: false,
    })
  })

  it('keeps distinct and expired application events as separate facts', () => {
    const first = { ...entry('first'), title: 'Failure', ts: 1_000 }
    expect(
      addEntry([first], { ...entry('distinct'), title: 'Other failure', ts: 2_000 }),
    ).toHaveLength(2)
    expect(
      addEntry([first], {
        ...entry('expired'),
        title: 'Failure',
        ts: 1_000 + 5 * 60_000 + 1,
      }),
    ).toHaveLength(2)
  })

  it('markRead flips one entry and is immutable when unchanged', () => {
    const list = [entry('a'), entry('b')]
    const next = markRead(list, 'a')
    expect(next.find((n) => n.id === 'a')?.read).toBe(true)
    expect(next.find((n) => n.id === 'b')?.read).toBe(false)
    // no-op returns the same reference (no needless re-render)
    expect(markRead(next, 'a')).toBe(next)
    expect(markRead(list, 'missing')).toBe(list)
  })

  it('markAllRead reads everything and is a no-op when all read', () => {
    const list = [entry('a'), entry('b', true)]
    const next = markAllRead(list)
    expect(next.every((n) => n.read)).toBe(true)
    expect(markAllRead(next)).toBe(next)
  })

  it('removeEntry filters by id', () => {
    const list = [entry('a'), entry('b')]
    expect(removeEntry(list, 'a').map((n) => n.id)).toEqual(['b'])
    expect(removeEntry(list, 'missing')).toBe(list)
  })

  it('unreadCount counts unread', () => {
    expect(unreadCount([entry('a'), entry('b', true), entry('c')])).toBe(2)
    expect(unreadCount([])).toBe(0)
  })
})
