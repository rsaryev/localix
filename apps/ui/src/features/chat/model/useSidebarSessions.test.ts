import { describe, expect, test } from 'bun:test'
import { sortSessionsList, scopeRootSessions } from './useSidebarSessions'
import type { UiSession } from '@/shared/api/contracts'

const s = (over: Partial<UiSession>): UiSession =>
  ({
    title: '',
    isPinned: false,
    updatedAt: 0,
    sessionKind: 'chat',
    ...over,
  }) as unknown as UiSession

const titles = (list: UiSession[]) => list.map((x) => x.title?.trim() || 'Untitled Chat')

describe('sortSessionsList', () => {
  test('recent mode: pinned first, then most-recently-updated', () => {
    const list = [
      s({ title: 'old', updatedAt: 100 }),
      s({ title: 'new', updatedAt: 300 }),
      s({ title: 'pinned-mid', updatedAt: 200, isPinned: true }),
    ]
    expect(titles(sortSessionsList(list, 'recent'))).toEqual(['pinned-mid', 'new', 'old'])
  })

  test('title mode: locale-alphabetical, empty titles fall back to "Untitled Chat"', () => {
    const list = [s({ title: 'banana' }), s({ title: 'apple' }), s({ title: '   ' })]
    expect(titles(sortSessionsList(list, 'title'))).toEqual(['apple', 'banana', 'Untitled Chat'])
  })

  test('title mode ignores pin state (pure alphabetical)', () => {
    const list = [s({ title: 'zeta', isPinned: true }), s({ title: 'alpha' })]
    expect(titles(sortSessionsList(list, 'title'))).toEqual(['alpha', 'zeta'])
  })

  test('does not mutate the input array', () => {
    const list = [s({ title: 'a', updatedAt: 1 }), s({ title: 'b', updatedAt: 2 })]
    const before = titles(list)
    sortSessionsList(list, 'recent')
    expect(titles(list)).toEqual(before)
  })
})

describe('scopeRootSessions (single-scope projection)', () => {
  const all = [
    s({ id: 'd1', title: 'default-a', projectId: 'PRJ-default' }),
    s({ id: 'p1a', title: 'proj1-a', projectId: 'p1' }),
    s({ id: 'p2a', title: 'proj2-a', projectId: 'p2' }),
  ]

  test('an unresolved scope (null) returns nothing — it is not a wildcard', () => {
    expect(scopeRootSessions(all, null, false)).toEqual([])
  })

  test('the default project is a scope like any other', () => {
    expect(scopeRootSessions(all, 'PRJ-default', false).map((x) => x.id)).toEqual(['d1'])
  })

  test("a project scope returns only that project's chats", () => {
    expect(scopeRootSessions(all, 'p1', false).map((x) => x.id)).toEqual(['p1a'])
    expect(scopeRootSessions(all, 'p2', false).map((x) => x.id)).toEqual(['p2a'])
  })

  test('never merges multiple projects into one scope', () => {
    const ids = scopeRootSessions(all, 'p1', false).map((x) => x.id)
    expect(ids).not.toContain('p2a')
    expect(ids).not.toContain('d1')
  })

  test('excludes threads, forks (chat-parented), and archived (unless shown)', () => {
    const list = [
      s({ id: 'root', projectId: 'p1' }),
      s({ id: 'fork', projectId: 'p1', parentSessionId: 'root' }),
      s({ id: 'thread', projectId: 'p1', sessionKind: 'system' }),
      s({ id: 'arch', projectId: 'p1', isArchived: true }),
    ]
    expect(scopeRootSessions(list, 'p1', false).map((x) => x.id)).toEqual(['root'])
    expect(
      scopeRootSessions(list, 'p1', true)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['arch', 'root'])
  })

  test('an orphaned fork (deleted parent) resurfaces as a root in its scope', () => {
    const list = [s({ id: 'orphan', projectId: 'p1', parentSessionId: 'gone' })]
    expect(scopeRootSessions(list, 'p1', false).map((x) => x.id)).toEqual(['orphan'])
  })

  test('a chat below a worker stays nested and is not repeated as a root', () => {
    const list = [
      s({ id: 'root', projectId: 'p1' }),
      s({ id: 'worker', projectId: 'p1', sessionKind: 'subagent', parentSessionId: 'root' }),
      s({ id: 'fork', projectId: 'p1', parentSessionId: 'worker' }),
    ]
    expect(scopeRootSessions(list, 'p1', false).map((row) => row.id)).toEqual(['root'])
  })
})
