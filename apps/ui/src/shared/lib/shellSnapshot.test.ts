import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'

import {
  forgetShellSnapshot,
  readShellSnapshot,
  rememberShellCapabilities,
  rememberShellSessions,
  SHELL_SNAPSHOT_SESSION_LIMIT,
} from './shellSnapshot'

// Map-backed stand-in — Bun has no DOM storage (same shape as persistence.test.ts).
function mapStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

beforeEach(() => installTestLocalStorage(mapStorage()))
afterEach(() => removeTestLocalStorage())

const frame = { revision: 7, enabledNames: ['sample-plugin'], plugins: [], views: [], tools: null }

describe('shell snapshot', () => {
  test('the roster written on one launch is the frame the next one paints', () => {
    rememberShellSessions(null, [{ id: 'a' }, { id: 'b' }])
    expect(readShellSnapshot<{ id: string }>(null)?.sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  test('both halves live in one record and neither erases the other', () => {
    rememberShellSessions(null, [{ id: 'a' }])
    rememberShellCapabilities(null, frame)
    const stored = readShellSnapshot<{ id: string }>(null)
    expect(stored?.sessions).toHaveLength(1)
    expect(stored?.capabilities?.enabledNames).toEqual(['sample-plugin'])
  })

  test('a frame from another project is not this project’s frame', () => {
    // Painting project A's rail inside project B is worse than painting nothing: it is
    // a confident answer about the wrong workspace.
    rememberShellCapabilities('project-a', frame)
    expect(readShellSnapshot('project-b')).toBeNull()
    expect(readShellSnapshot(null)).toBeNull()
    expect(readShellSnapshot('project-a')?.capabilities?.revision).toBe(7)
  })

  test('changing scope replaces the record rather than mixing the two', () => {
    rememberShellSessions('project-a', [{ id: 'a' }])
    rememberShellCapabilities('project-b', frame)
    expect(readShellSnapshot('project-a')).toBeNull()
    expect(readShellSnapshot('project-b')?.sessions).toEqual([])
  })

  test('an older schema is dropped, not misread', () => {
    localStorage.setItem(
      'localix_shell_snapshot',
      JSON.stringify({ v: 0, projectId: null, sessions: [{ id: 'a' }], capabilities: null }),
    )
    expect(readShellSnapshot(null)).toBeNull()
  })

  test('unreadable storage degrades to "no snapshot", never to a throw', () => {
    localStorage.setItem('localix_shell_snapshot', '{not json')
    expect(readShellSnapshot(null)).toBeNull()
    // A record of the right shape but the wrong type is equally not a frame.
    localStorage.setItem('localix_shell_snapshot', JSON.stringify({ v: 1, sessions: 'nope' }))
    expect(readShellSnapshot(null)).toBeNull()
  })

  test('the roster is capped so a huge history cannot become a startup cost', () => {
    const many = Array.from({ length: SHELL_SNAPSHOT_SESSION_LIMIT + 50 }, (_, i) => ({ id: i }))
    rememberShellSessions(null, many)
    expect(readShellSnapshot(null)?.sessions).toHaveLength(SHELL_SNAPSHOT_SESSION_LIMIT)
  })

  test('forgetting clears both halves', () => {
    rememberShellSessions(null, [{ id: 'a' }])
    forgetShellSnapshot()
    expect(readShellSnapshot(null)).toBeNull()
  })
})
