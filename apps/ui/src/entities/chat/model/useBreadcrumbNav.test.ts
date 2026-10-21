import { describe, expect, mock, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { sessionCrumbItems } from './useBreadcrumbNav'

const chat = (id: string, handle: string, projectId = 'PRJ-0'): UiSession =>
  ({
    id,
    agents: [{ handle }],
    projectId,
    title: id,
    updatedAt: 1,
    sessionKind: 'chat',
    parentSessionId: null,
  }) as UiSession

const allSessions = [
  chat('a', 'localix'),
  chat('b', 'backend'),
  chat('c', 'backend'),
  chat('d', 'localix', 'PRJ-1'),
]

describe('session crumb navigation', () => {
  const deps = {
    allSessions,
    activeProjectId: 'PRJ-0',
    activeSessionId: 'a',
    goToSession: () => {},
  }

  test('offers the selected project’s chats across all agents', () => {
    const items = sessionCrumbItems(deps)
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(items.filter((item) => item.active).map((item) => item.id)).toEqual(['a'])
  })

  test('keeps other projects, archived chats and descendants out of the root menu', () => {
    const items = sessionCrumbItems({
      ...deps,
      allSessions: [
        ...allSessions,
        { ...chat('archived', 'localix'), isArchived: true },
        { ...chat('fork', 'localix'), parentSessionId: 'a' },
        { ...chat('worker', 'localix'), sessionKind: 'subagent', parentSessionId: 'a' },
      ],
    })
    expect(items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(sessionCrumbItems({ ...deps, activeProjectId: 'PRJ-1' }).map((item) => item.id)).toEqual(
      ['d'],
    )
  })

  test('selecting another agent’s chat navigates to that chat', () => {
    const goToSession = mock((_id: string) => {})
    const items = sessionCrumbItems({ ...deps, goToSession })
    items.find((item) => item.id === 'b')!.onSelect()
    expect(goToSession).toHaveBeenCalledWith('b')
  })

  test('an unresolved project does not fall back to other workspaces', () => {
    expect(sessionCrumbItems({ ...deps, activeProjectId: null })).toEqual([])
  })
})
