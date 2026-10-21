import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { UiSession } from '@/shared/api/contracts'
import { clearLiveSessionBodies, getLiveSessionBody } from './sessionListHelpers'
import { useChatStore } from './store'

let originalState: ReturnType<typeof useChatStore.getState>

function session(overrides: Partial<UiSession> = {}): UiSession {
  return {
    id: 'session-1',
    seq: 1,
    title: 'Streaming chat',
    messages: [{ id: 'assistant-1', role: 'assistant', content: 'hel' }],
    bodyLoaded: true,
    isPinned: false,
    isArchived: false,
    createdAt: 1,
    updatedAt: 1,
    providerConnectionId: null,
    modelId: '',
    reasoningEffort: 'low',
    pendingInteraction: null,
    pendingInteractionQueue: [],
    isRunning: true,
    projectId: 'PRJ-1',
    parentSessionId: null,
    rootSessionId: null,
    sessionKind: 'chat',
    ...overrides,
  } as UiSession
}

beforeEach(() => {
  originalState = useChatStore.getState()
  clearLiveSessionBodies()
  const active = session()
  useChatStore.setState({
    sessions: [active],
    allSessions: [active],
    activeSessionId: active.id,
    activeProjectId: 'PRJ-1',
  })
})

afterEach(() => {
  clearLiveSessionBodies()
  useChatStore.setState(originalState, true)
})

describe('workspace hydration during a live stream', () => {
  test('commits side-cached message deltas before replacing the roster snapshot', () => {
    const store = useChatStore.getState()
    store._applyStreamEvent('session-1', {
      type: 'message.delta',
      sessionId: 'session-1',
      messageId: 'assistant-1',
      contentAppend: 'lo',
    })

    expect(getLiveSessionBody('session-1')?.messages[0]?.content).toBe('hello')

    const summary = session({
      messages: [],
      bodyLoaded: false,
      isRunning: true,
      updatedAt: 2,
    })
    useChatStore.getState().hydrateWorkspace({
      sessions: [summary],
      activeSessionId: 'session-1',
    })

    const hydrated = useChatStore.getState().sessions[0]
    expect(hydrated?.messages[0]?.content).toBe('hello')
    expect(hydrated?.bodyLoaded).toBe(true)
    expect(getLiveSessionBody('session-1')).toBeUndefined()
  })
})
