import { describe, expect, test } from 'bun:test'

import { workItemRequestOf } from './useUiNavigation'

describe('the tab a work-item target opens', () => {
  const target = {
    kind: 'work-item' as const,
    workKind: 'game:board',
    id: 'game:board',
    title: 'Board',
  }

  test('a target that names its session opens in that session', () => {
    expect(workItemRequestOf({ ...target, session: 'S-A' }, null)).toEqual({
      workKind: 'game:board',
      id: 'game:board',
      title: 'Board',
      scope: 'S-A',
    })
  })

  test("the target's own session wins over the session the navigation acts for", () => {
    expect(workItemRequestOf({ ...target, session: 'S-A' }, 'S-B').scope).toBe('S-A')
  })

  test('a bare target opens in the session the navigation acts for', () => {
    expect(workItemRequestOf(target, 'S-B').scope).toBe('S-B')
  })

  test('with neither, the scope is null — the grid refuses a session kind instead of guessing', () => {
    expect(workItemRequestOf(target, null).scope).toBeNull()
  })
})
