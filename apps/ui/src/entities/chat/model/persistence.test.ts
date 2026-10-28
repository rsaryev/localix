import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'

import * as persistence from './persistence'
import {
  forgetLastWorkspace,
  forgetSessionLocation,
  loadLastWorkspace,
  loadRememberedActiveSession,
  recordChatLocation,
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
    recordChatLocation('p1', 's1')
    expect(loadRememberedActiveSession('p1')).toBe('s1')
  })
})

describe('persistence — project-scoped active session key', () => {
  beforeEach(() => installStorage())

  test('each project remembers its own chat', () => {
    recordChatLocation('proj-a', 'proj-a-s')
    recordChatLocation('proj-b', 'proj-b-s')

    expect(loadRememberedActiveSession('proj-a')).toBe('proj-a-s')
    expect(loadRememberedActiveSession('proj-b')).toBe('proj-b-s')
  })

  test('forgetting a deleted chat clears only the records that name it', () => {
    recordChatLocation('proj-a', 'keep')
    recordChatLocation('proj-b', 'drop')
    forgetSessionLocation('proj-b', 'drop')
    forgetSessionLocation('proj-a', 'other')

    expect(loadRememberedActiveSession('proj-a')).toBe('keep')
    expect(loadRememberedActiveSession('proj-b')).toBeNull()
    expect(loadLastWorkspace()).toEqual({ projectId: 'proj-b', sessionId: null })
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
    expect(() => recordChatLocation('p', 'x')).not.toThrow()
  })
})

describe('persistence — the launch-restore pair', () => {
  beforeEach(() => installStorage())

  test('marking a chat active records the scope+chat pair atomically', () => {
    expect(loadLastWorkspace()).toBeNull()
    recordChatLocation('p1', 's1')
    expect(loadLastWorkspace()).toEqual({ projectId: 'p1', sessionId: 's1' })
  })

  test('the pair follows the LAST scope entered, not the most recent per-scope key', () => {
    // Both per-scope keys survive (they serve in-app scope round-trips), but the pair names
    // exactly one scope — the one to reopen. Reading the two keys back separately is what
    // could pair project A with project B's chat.
    recordChatLocation('p1', 'p1-chat')
    recordChatLocation('p2', 'p2-chat')

    expect(loadRememberedActiveSession('p1')).toBe('p1-chat')
    expect(loadLastWorkspace()).toEqual({ projectId: 'p2', sessionId: 'p2-chat' })
  })

  test('deleting the scope-s last chat keeps the scope restorable', () => {
    recordChatLocation('p1', 's1')
    forgetSessionLocation('p1', 's1')
    expect(loadLastWorkspace()).toEqual({ projectId: 'p1', sessionId: null })
  })

  test('an absent record restores nothing', () => {
    const map = installStorage()
    recordChatLocation('p1', 's1')
    map.delete('localix_last_workspace')

    expect(loadLastWorkspace()).toBeNull()
  })

  test('a pair confirmed dead stays dead', () => {
    recordChatLocation('p-gone', 's1')
    forgetLastWorkspace()
    expect(loadLastWorkspace()).toBeNull()
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
