import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { ApiError } from '@/shared/api/internal'
import {
  isDeadRoutedProject,
  isMissingProjectError,
  isMissingRoutedSessionError,
  shouldLoadRoutedSession,
} from './urlSessionSelection'

const session = (id: string, bodyLoaded?: boolean) =>
  ({ id, messages: [], bodyLoaded }) as unknown as UiSession

describe('shouldLoadRoutedSession', () => {
  test('loads an active summary instead of mistaking it for an empty conversation', () => {
    const summary = session('s1', false)
    expect(
      shouldLoadRoutedSession(
        { activeSessionId: 's1', sessions: [summary], allSessions: [summary] },
        's1',
      ),
    ).toBe(true)
  })

  test('loads an active id whose row has not reached either session roster yet', () => {
    expect(
      shouldLoadRoutedSession({ activeSessionId: 's1', sessions: [], allSessions: [] }, 's1'),
    ).toBe(true)
  })

  test('does not refetch an already loaded active body', () => {
    const detail = session('s1', true)
    expect(
      shouldLoadRoutedSession(
        { activeSessionId: 's1', sessions: [detail], allSessions: [detail] },
        's1',
      ),
    ).toBe(false)
  })

  test('loads a different routed session regardless of its current body state', () => {
    const detail = session('s2', true)
    expect(
      shouldLoadRoutedSession(
        { activeSessionId: 's1', sessions: [detail], allSessions: [detail] },
        's2',
      ),
    ).toBe(true)
  })
})

describe('isMissingRoutedSessionError', () => {
  test('only classifies permanently absent routed sessions', () => {
    expect(isMissingRoutedSessionError(new ApiError('missing', 404))).toBe(true)
    expect(isMissingRoutedSessionError(new ApiError('gone', 410))).toBe(true)
    expect(isMissingRoutedSessionError(new ApiError('starting', 503))).toBe(false)
    expect(isMissingRoutedSessionError(new Error('offline'))).toBe(false)
  })
})

describe('isDeadRoutedProject', () => {
  const roster = { projects: [{ id: 'PRJ-1' }], projectsLoaded: true }

  test('a routed project the answered roster lacks is dead (recreated database)', () => {
    expect(isDeadRoutedProject(roster, 'PRJ-11')).toBe(true)
  })

  test('nothing is judged before the roster answers', () => {
    expect(isDeadRoutedProject({ projects: [], projectsLoaded: false }, 'PRJ-11')).toBe(false)
  })

  test('a live project and the neutral route are never dead', () => {
    expect(isDeadRoutedProject(roster, 'PRJ-1')).toBe(false)
    expect(isDeadRoutedProject(roster, null)).toBe(false)
  })
})

describe('isMissingProjectError', () => {
  test('recognizes only project_not_found', () => {
    expect(isMissingProjectError(new ApiError('Project not found', 404, 'project_not_found'))).toBe(
      true,
    )
    expect(isMissingProjectError(new ApiError('gone', 404, 'session_not_found'))).toBe(false)
    expect(isMissingProjectError(new Error('Project not found'))).toBe(false)
  })
})
