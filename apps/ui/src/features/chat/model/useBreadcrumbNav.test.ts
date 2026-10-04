import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { sessionsInBranch } from './useBreadcrumbNav'

const route = (handle: string) => ({
  handle,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'low' as const,
})

const chat = (id: string, handle: string, projectId = 'PRJ-0'): UiSession =>
  ({
    id,
    agents: [route(handle)],
    projectId,
    updatedAt: 1,
    sessionKind: 'chat',
    parentSessionId: null,
  }) as UiSession

const ALL = [
  chat('a', 'localix'),
  chat('b', 'backend'),
  chat('c', 'backend'),
  chat('d', 'localix', 'PRJ-1'),
]

describe('sessionsInBranch', () => {
  test('a level only offers what lives inside the level above it', () => {
    // The bug this pins: standing in `Project / Backend / a chat`, the session dropdown listed
    // every root chat in the scope — including other agents' — so the last segment of a path
    // could take you out of that path.
    expect(sessionsInBranch(ALL, 'PRJ-0', 'backend').map((s) => s.id)).toEqual(['b', 'c'])
  })

  test('the scope still bounds it', () => {
    // Two containments, not one: the agent narrows within the scope, it does not replace it.
    expect(sessionsInBranch(ALL, 'PRJ-1', 'localix').map((s) => s.id)).toEqual(['d'])
  })

  test('with no agent in the path, the whole scope is the branch', () => {
    // Nothing open yet — there is no branch to be inside of.
    expect(sessionsInBranch(ALL, 'PRJ-0', undefined).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  test('an agent with nothing in this scope offers nothing', () => {
    expect(sessionsInBranch(ALL, 'PRJ-0', 'qa')).toEqual([])
  })
})
