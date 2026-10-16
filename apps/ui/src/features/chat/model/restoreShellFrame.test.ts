import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'

import type { UiSession } from '@/shared/api/contracts'
import { rememberShellSessions } from '@/shared/lib/shellSnapshot'

import { restoreShellFrame } from './restoreShellFrame'
import { useChatStore } from './store'

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

const PROJECT = 'PRJ-1'

const session = (id: string): UiSession =>
  ({
    id,
    seq: 0,
    title: id,
    messages: [],
    bodyLoaded: false,
    projectId: PROJECT,
    parentSessionId: null,
  }) as unknown as UiSession

beforeEach(() => {
  installTestLocalStorage(mapStorage())
  useChatStore.setState({
    allSessions: [],
    sessions: [],
    activeSessionId: null,
    activeProjectId: null,
    _hasHydrated: false,
  })
})
afterEach(() => removeTestLocalStorage())

describe('restoring the shell frame', () => {
  test('the first frame already has the roster the last launch confirmed', () => {
    rememberShellSessions(PROJECT, [session('LOCALIX-1'), session('LOCALIX-2')])
    localStorage.setItem('localix_active_project_id', PROJECT)

    expect(restoreShellFrame()).toBe(true)
    const state = useChatStore.getState()
    // `_hasHydrated` is what every shell surface gates on: the sidebar and the whole
    // activity rail render EMPTY until it flips. Flipping it here is the entire point.
    expect(state._hasHydrated).toBe(true)
    expect(state.sessions.map((s) => s.id)).toEqual(['LOCALIX-1', 'LOCALIX-2'])
  })

  test('the remembered session is the active one, not just the first', () => {
    rememberShellSessions(PROJECT, [session('LOCALIX-1'), session('LOCALIX-2')])
    localStorage.setItem('localix_active_project_id', PROJECT)
    localStorage.setItem(`localix_active_session_id_${PROJECT}`, 'LOCALIX-2')

    restoreShellFrame()
    expect(useChatStore.getState().activeSessionId).toBe('LOCALIX-2')
  })

  test('a remembered session the roster no longer has falls back rather than sticking', () => {
    rememberShellSessions(PROJECT, [session('LOCALIX-1')])
    localStorage.setItem('localix_active_project_id', PROJECT)
    localStorage.setItem(`localix_active_session_id_${PROJECT}`, 'LOCALIX-DELETED')

    restoreShellFrame()
    expect(useChatStore.getState().activeSessionId).toBe('LOCALIX-1')
  })

  test('a first-ever launch restores nothing and changes nothing', () => {
    expect(restoreShellFrame()).toBe(false)
    expect(useChatStore.getState()._hasHydrated).toBe(false)
  })
})

/**
 * The frame used to record merged BODIES — a plan still `presented` hours after its
 * approval, with `bodyLoaded: true` — so every launch painted it as loaded, never refetched the
 * chat, and wrote it back. Both ends now carry a roster only.
 */
describe('the frame is a roster, never a body', () => {
  const body = (id: string): UiSession =>
    ({
      ...session(id),
      bodyLoaded: true,
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
      plans: [{ id: 'p1', version: 1, status: 'presented' }],
    }) as unknown as UiSession

  test('a record that holds a body is restored as not loaded, without its plans', () => {
    // A record written before the projection existed — exactly what is on disk today.
    rememberShellSessions(PROJECT, [body('LOCALIX-206')])
    localStorage.setItem('localix_active_project_id', PROJECT)

    restoreShellFrame()
    const restored = useChatStore.getState().sessions[0]!
    expect(restored.bodyLoaded).toBe(false)
    expect(restored.messages).toEqual([])
    expect(restored.plans).toBeUndefined()
  })

  test('a hydrate over loaded bodies records only the roster', () => {
    useChatStore.setState({ activeProjectId: PROJECT, allSessions: [body('LOCALIX-206')] })
    useChatStore.getState().hydrateWorkspace({
      sessions: [session('LOCALIX-206')],
      connections: [],
      activeSessionId: null,
    })

    const stored = JSON.parse(localStorage.getItem('localix_shell_snapshot') ?? '{}')
    expect(stored.sessions).toHaveLength(1)
    expect(stored.sessions[0].bodyLoaded).toBe(false)
    expect(stored.sessions[0].messages).toEqual([])
    expect('plans' in stored.sessions[0]).toBe(false)
  })
})
