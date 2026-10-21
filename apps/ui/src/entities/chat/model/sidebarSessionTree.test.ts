import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import {
  matchesSidebarSession,
  sidebarChildren,
  sidebarSessionChildren,
  sidebarSessionPath,
} from './sidebarSessionTree'

const session = (id: string, patch: Partial<UiSession> = {}) =>
  ({ id, title: id, sessionKind: 'chat', ...patch }) as UiSession
const root = session('root')
const parent = session('delegate', { sessionKind: 'subagent', parentSessionId: root.id })
const child = session('review', {
  sessionKind: 'subagent',
  parentSessionId: parent.id,
  rootSessionId: root.id,
})

describe('sidebar session hierarchy', () => {
  test('keeps a worker under its actual parent rather than flattening it under the root', () => {
    const index = sidebarSessionChildren([root, parent, child])
    expect(sidebarChildren(root.id, index).map((s) => s.id)).toEqual(['delegate'])
    expect(sidebarChildren(parent.id, index).map((s) => s.id)).toEqual(['review'])
    expect(sidebarSessionPath(child.id, index)).toEqual(['root', 'delegate', 'review'])
  })

  test('keeps orphaned workers reachable through their owning root', () => {
    const orphan = session('orphan', {
      sessionKind: 'job',
      parentSessionId: 'deleted',
      rootSessionId: root.id,
    })
    const index = sidebarSessionChildren([root, orphan])
    expect(sidebarChildren(root.id, index)).toEqual([orphan])
    expect(sidebarSessionPath(orphan.id, index)).toEqual(['root', 'orphan'])
  })

  test('search follows workers, threads and forks while retaining their ancestors', () => {
    const thread = session('thread', {
      sessionKind: 'system',
      parentSessionId: child.id,
      title: 'Accessibility findings',
    })
    const fork = session('fork', { parentSessionId: thread.id, title: 'Fix contrast' })
    const index = sidebarSessionChildren([root, parent, child, thread, fork])
    expect(matchesSidebarSession(root, 'accessibility', index)).toBe(true)
    expect(matchesSidebarSession(root, 'contrast', index)).toBe(true)
    expect(matchesSidebarSession(parent, 'contrast', index)).toBe(true)
    expect(matchesSidebarSession(root, 'missing', index)).toBe(false)
    expect(sidebarSessionPath(fork.id, index)).toEqual([
      'root',
      'delegate',
      'review',
      'thread',
      'fork',
    ])
  })

  test('malformed cycles do not hang search or path resolution', () => {
    const a = session('a', { parentSessionId: 'b' })
    const b = session('b', { parentSessionId: 'a' })
    const index = sidebarSessionChildren([a, b])
    expect(matchesSidebarSession(a, 'missing', index)).toBe(false)
    expect(sidebarSessionPath(a.id, index)).toEqual(['b', 'a'])
    expect(
      sidebarChildren('a', sidebarSessionChildren([session('a', { parentSessionId: 'a' })])),
    ).toEqual([])
  })
})
