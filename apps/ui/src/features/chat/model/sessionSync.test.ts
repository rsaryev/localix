import { afterEach, describe, expect, test } from 'bun:test'
import type { Project, UiSession } from '@/shared/api/contracts'
import { applyServerProjects, applyServerSession } from './sessionSync'
import { findSessionInState } from './findSession'
import { useChatStore } from './store'

const original = useChatStore.getState()
afterEach(() => useChatStore.setState(original, true))

function session(overrides: Partial<UiSession>): UiSession {
  return {
    id: 's1',
    title: 'New Chat',
    sessionKind: 'chat',
    parentSessionId: null,
    isRunning: false,
    messages: [],
    messageCount: 0,
    isPinned: false,
    updatedAt: 0,
    projectId: null,
    ...overrides,
  } as UiSession
}

describe('the chat sync layer', () => {
  test('a server session replaces the stored copy and seats it when nothing is on screen', () => {
    useChatStore.setState({ sessions: [session({ title: 'Old' })], activeSessionId: null })
    applyServerSession(session({ title: 'Renamed' }))
    const state = useChatStore.getState()
    expect(findSessionInState(state, 's1')?.title).toBe('Renamed')
    expect(state.activeSessionId).toBe('s1')
  })

  test('a reconcile also settles the run flag the server reports', () => {
    useChatStore.setState({ sessions: [session({ isRunning: true })], activeSessionId: 's1' })
    applyServerSession(session({ isRunning: true }), { running: false })
    expect(findSessionInState(useChatStore.getState(), 's1')?.isRunning).toBe(false)
  })

  test('a fetched roster marks the projects loaded', () => {
    const projects = [{ id: 'p1', name: 'One' } as Project]
    applyServerProjects(projects)
    expect(useChatStore.getState().projects).toEqual(projects)
    expect(useChatStore.getState().projectsLoaded).toBe(true)
  })
})
