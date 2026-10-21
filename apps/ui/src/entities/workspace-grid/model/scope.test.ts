import { describe, expect, test } from 'bun:test'
import {
  GLOBAL_SCOPE,
  isVisibleInScope,
  resolveOpenScope,
  scopeOf,
  sessionOfScope,
  tabIdInScope,
} from './scope'

describe('scopeOf', () => {
  test('an unstamped (legacy/restored) item is treated as global, never lost', () => {
    expect(scopeOf(undefined)).toBe(GLOBAL_SCOPE)
  })

  test('a stamped scope is returned verbatim', () => {
    expect(scopeOf('session-1')).toBe('session-1')
    expect(scopeOf(GLOBAL_SCOPE)).toBe(GLOBAL_SCOPE)
  })
})

describe('isVisibleInScope', () => {
  test('a global tab is visible under any active scope', () => {
    expect(isVisibleInScope(GLOBAL_SCOPE, 'A')).toBe(true)
    expect(isVisibleInScope(GLOBAL_SCOPE, GLOBAL_SCOPE)).toBe(true)
  })

  test('an unstamped tab is always visible (legacy → global)', () => {
    expect(isVisibleInScope(undefined, 'A')).toBe(true)
  })

  test('a session tab is visible only inside its own session', () => {
    expect(isVisibleInScope('A', 'A')).toBe(true)
    expect(isVisibleInScope('A', 'B')).toBe(false)
    // …and hidden when the global scope is focused (no session active).
    expect(isVisibleInScope('A', GLOBAL_SCOPE)).toBe(false)
  })
})

describe('resolveOpenScope', () => {
  const SESSION = 'session-1'
  const SESSION_KINDS = [
    'chat',
    'file',
    'diff',
    'terminal',
    'preview',
    'problems',
    'message-replay',
    'global-search',
    'plugin-view',
  ] as const

  test('a session kind lands in the session its opener names', () => {
    for (const k of SESSION_KINDS) expect(resolveOpenScope(k, SESSION)).toBe(SESSION)
  })

  test('a session kind that names no session is refused, never given the chat on screen', () => {
    // The singletons used to land in GLOBAL and follow whichever chat was open; an unscoped file
    // took the focused session. Both were guesses.
    for (const k of SESSION_KINDS) {
      expect(resolveOpenScope(k, undefined)).toBeNull()
      expect(resolveOpenScope(k, GLOBAL_SCOPE)).toBeNull()
    }
  })

  test('only the app-level kinds live in GLOBAL_SCOPE, whatever the opener names', () => {
    for (const k of ['stats', 'agent', 'settings'] as const) {
      expect(resolveOpenScope(k, undefined)).toBe(GLOBAL_SCOPE)
      expect(resolveOpenScope(k, SESSION)).toBe(GLOBAL_SCOPE)
    }
  })
})

describe('sessionOfScope', () => {
  test('a session tab names its session; an app-level tab names none', () => {
    expect(sessionOfScope('session-1')).toBe('session-1')
    expect(sessionOfScope(GLOBAL_SCOPE)).toBeNull()
  })
})

describe('tabIdInScope', () => {
  test('a core singleton is one tab per chat, so its fixed id is qualified by the chat', () => {
    expect(tabIdInScope('preview', 'preview', 'A')).toBe('preview@A')
    expect(tabIdInScope('preview', 'preview', 'B')).toBe('preview@B')
    expect(tabIdInScope('preview', 'preview@A', 'A')).toBe('preview@A')
  })

  test('an app-level tab and a non-singleton core tab keep their own ids', () => {
    expect(tabIdInScope('settings', 'settings', GLOBAL_SCOPE)).toBe('settings')
    expect(tabIdInScope('chat', 'chat:A', 'A')).toBe('chat:A')
  })
})
