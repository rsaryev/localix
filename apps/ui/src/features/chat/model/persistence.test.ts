import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'

import * as persistence from './persistence'
import {
  forgetLastWorkspace,
  loadActiveProjectId,
  loadLastWorkspace,
  loadRememberedActiveSession,
  rememberActiveProjectId,
  rememberActiveSession,
  rememberLastWorkspace,
} from './persistence'

// Minimal Map-backed localStorage stand-in (Bun has no DOM storage).
function installStorage(impl?: Partial<Storage>) {
  const map = new Map<string, string>()
  const store: Storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    ...impl,
  }
  installTestLocalStorage(store)
  return map
}

afterEach(() => {
  removeTestLocalStorage()
})

describe('persistence — round trips', () => {
  beforeEach(() => installStorage())

  test('no server-owned identifier is kept in the browser', () => {
    // The model and the provider connection a chat starts on used to live here. localStorage
    // outlives the database, so a recreated one left the app sending a connection id that
    // addressed nothing and creating a group answered 500. Both answers are the server's now:
    // the project's setting, and the route each agent was last on.
    const surface = Object.keys(persistence)
    expect(surface).not.toContain('loadLastModel')
    expect(surface).not.toContain('rememberLastModel')
    expect(surface).not.toContain('loadLastConnection')
    expect(surface).not.toContain('rememberLastConnection')
  })

  test('what the browser does own still round-trips', () => {
    // The positive control for the assertion above: the file still works, it just holds
    // preferences and navigation rather than pointers into the database.
    rememberActiveSession('s1', 'p1')
    expect(loadRememberedActiveSession('p1')).toBe('s1')
  })

  test('active project id: set, read, and clear with null', () => {
    rememberActiveProjectId('proj-1')
    expect(loadActiveProjectId()).toBe('proj-1')
    rememberActiveProjectId(null)
    expect(loadActiveProjectId()).toBeNull()
  })
})

describe('persistence — project-scoped active session key', () => {
  beforeEach(() => installStorage())

  test('global and per-project sessions live under independent keys', () => {
    rememberActiveSession('global-s')
    rememberActiveSession('proj-a-s', 'proj-a')
    rememberActiveSession('proj-b-s', 'proj-b')

    expect(loadRememberedActiveSession()).toBe('global-s')
    expect(loadRememberedActiveSession('proj-a')).toBe('proj-a-s')
    expect(loadRememberedActiveSession('proj-b')).toBe('proj-b-s')
  })

  test('null id removes only that scope', () => {
    rememberActiveSession('keep', 'proj-a')
    rememberActiveSession('drop', 'proj-b')
    rememberActiveSession(null, 'proj-b')

    expect(loadRememberedActiveSession('proj-a')).toBe('keep')
    expect(loadRememberedActiveSession('proj-b')).toBeNull()
  })
})

describe('persistence — degrades gracefully on storage failure', () => {
  test('throwing storage → reads return null, writes do not throw', () => {
    installStorage({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })

    expect(loadRememberedActiveSession('p')).toBeNull()
    expect(loadActiveProjectId()).toBeNull()
    expect(() => rememberActiveSession('x', 'p')).not.toThrow()
    expect(() => rememberActiveProjectId('x')).not.toThrow()
  })
})

describe('persistence — the launch-restore pair', () => {
  beforeEach(() => installStorage())

  test('marking a chat active records the scope+chat pair atomically', () => {
    expect(loadLastWorkspace()).toBeNull()
    rememberActiveSession('s1', 'p1')
    expect(loadLastWorkspace()).toEqual({ projectId: 'p1', sessionId: 's1' })
  })

  test('the pair follows the LAST scope entered, not the most recent per-scope key', () => {
    // Both per-scope keys survive (they serve in-app scope round-trips), but the pair names
    // exactly one scope — the one to reopen. Reading the two keys back separately is what
    // could pair project A with project B's chat.
    rememberActiveSession('p1-chat', 'p1')
    rememberActiveSession('p2-chat', 'p2')

    expect(loadRememberedActiveSession('p1')).toBe('p1-chat')
    expect(loadLastWorkspace()).toEqual({ projectId: 'p2', sessionId: 'p2-chat' })
  })

  test('deleting the scope-s last chat keeps the scope restorable', () => {
    rememberActiveSession('s1', 'p1')
    rememberActiveSession(null, 'p1')
    expect(loadLastWorkspace()).toEqual({ projectId: 'p1', sessionId: null })
  })

  test('an absent record falls back to the legacy keys so one update does not lose the workspace', () => {
    rememberActiveProjectId('p-legacy')
    rememberActiveSession('s-legacy', 'p-legacy')
    forgetLastWorkspace()

    expect(loadLastWorkspace()).toEqual({ projectId: 'p-legacy', sessionId: 's-legacy' })
  })

  test('a corrupt or empty record reads as nothing to restore', () => {
    const map = installStorage()
    map.set('localix_last_workspace', 'not json{')
    expect(loadLastWorkspace()).toBeNull()

    map.set('localix_last_workspace', JSON.stringify({ projectId: 42, sessionId: [] }))
    expect(loadLastWorkspace()).toBeNull()

    rememberLastWorkspace(null, null)
    expect(loadLastWorkspace()).toBeNull()
  })

  test('unavailable storage degrades to no restore instead of throwing', () => {
    installStorage({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })

    expect(loadLastWorkspace()).toBeNull()
    expect(() => rememberLastWorkspace('p', 's')).not.toThrow()
    expect(() => forgetLastWorkspace()).not.toThrow()
  })
})
