import { expect, test, spyOn } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import { sessionRosterEventPatch } from './sessionRosterEvents'
import { mergeSessionState } from './sessionListHelpers'
import type { ChatStore } from './store'
import { useChatStore } from './store'

const summary = (id: string, extra = {}) =>
  ({
    type: 'session.updated',
    session: {
      id,
      seq: 1,
      title: id,
      isPinned: false,
      isArchived: false,
      projectId: 'project',
      sessionKind: 'chat',
      runtimeStatus: 'idle',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      agents: [],
      ...extra,
    },
  }) as unknown as AgentStreamEvent

test('a new chat in another window enters both roster and project list without changing focus', () => {
  const state = {
    allSessions: [],
    sessions: [],
    activeSessionId: 'existing',
    activeProjectId: 'project',
  } as unknown as ChatStore
  const patch = sessionRosterEventPatch(state, summary('new'))!
  const next = { ...state, ...mergeSessionState(state, patch) }
  expect(next.allSessions.map((s) => s.id)).toEqual(['new'])
  expect(next.sessions.map((s) => s.id)).toEqual(['new'])
  expect(next.activeSessionId).toBe('existing')
  expect(next.sessions[0]?.bodyLoaded).toBe(false)
})

test('metadata updates preserve loaded body and optimistic run state and apply archive/move', () => {
  const messages = [
    { id: 'pending', role: 'user', content: 'draft', optimistic: true },
  ] as unknown as UiSession['messages']
  const chat = {
    id: 'chat',
    projectId: 'project',
    messages,
    bodyLoaded: true,
    isRunning: true,
  } as unknown as UiSession
  const state = {
    allSessions: [chat],
    sessions: [chat],
    activeSessionId: 'chat',
    activeProjectId: 'project',
  } as ChatStore
  const patch = sessionRosterEventPatch(
    state,
    summary('chat', { isArchived: true, projectId: 'other' }),
  )!
  const next = mergeSessionState(state, patch)
  expect(next.allSessions?.[0]?.messages).toBe(messages)
  expect(next.allSessions?.[0]?.isArchived).toBe(true)
  expect(next.allSessions?.[0]?.isRunning).toBe(true)
  expect(next.sessions).toEqual([])
})

test('deletion removes descendants and clears focus only if the open chat was removed', () => {
  const rows = ['root', 'child', 'other'].map(
    (id) => ({ id, projectId: 'project', updatedAt: 0, messages: [] }) as unknown as UiSession,
  )
  const state = {
    allSessions: rows,
    sessions: rows,
    activeSessionId: 'child',
    activeProjectId: 'project',
  } as ChatStore
  const patch = sessionRosterEventPatch(state, {
    type: 'session.deleted',
    sessionIds: ['root', 'child'],
  })!
  const next = mergeSessionState(state, patch)
  expect(next.allSessions?.map((s) => s.id)).toEqual(['other'])
  expect(next.sessions?.map((s) => s.id)).toEqual(['other'])
  expect(next.activeSessionId).toBeNull()
})

test('a completed worker clears its running state without losing its loaded body', () => {
  const child = {
    id: 'worker',
    messages: [],
    projectId: 'project',
    isRunning: true,
    bodyLoaded: true,
  } as unknown as UiSession
  const state = {
    sessions: [child],
    allSessions: [child],
    activeSessionId: 'root',
    activeProjectId: 'project',
  } as ChatStore
  const update = summary('worker', { runtimeStatus: 'completed', sessionKind: 'job' })
  if (update.type !== 'session.updated') throw new Error('fixture')
  const patch = sessionRosterEventPatch(state, {
    type: 'child_session.updated',
    parentSessionId: 'root',
    session: update.session,
  })!
  expect(patch.allSessions?.[0]?.isRunning).toBe(false)
  expect(patch.allSessions?.[0]?.bodyLoaded).toBe(true)
  expect(patch.allSessions?.[0]?.messages).toBe(child.messages)
})

test('a detail response crossing a deletion never revives the conversation or its warm cache', async () => {
  const before = useChatStore.getState()
  const chat = {
    id: 'cross-window-chat',
    messages: [],
    projectId: 'project',
    isRunning: false,
    bodyLoaded: true,
  } as unknown as UiSession
  let resolve!: (value: UiSession) => void
  const response = new Promise<UiSession>((done) => {
    resolve = done
  })
  const fetch = spyOn(backendClient, 'getSession').mockImplementation(() => response)
  useChatStore.setState({
    allSessions: [chat],
    activeProjectId: 'project',
    activeSessionId: chat.id,
  })
  try {
    const pending = useChatStore.getState().selectSession(chat.id)
    useChatStore
      .getState()
      ._applyStreamEvent('', { type: 'session.deleted', sessionIds: [chat.id] })
    resolve(chat)
    await pending
    expect(useChatStore.getState().allSessions).toEqual([])
    expect(useChatStore.getState().activeSessionId).toBeNull()
  } finally {
    fetch.mockRestore()
    useChatStore.setState(before)
  }
})
