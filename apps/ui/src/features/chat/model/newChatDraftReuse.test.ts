import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { createSessionActions } from './sessionActionsSlice'
import { mergeSessionState } from './sessionListHelpers'
import { scopedNewConversation } from './conversationStartStrategy'
import type { ChatStore } from './store'

// REPRO: pressing New chat three times landed in three different OLD chats before a
// new one appeared. Used chats whose title was still "New Chat" sat in the roster with
// no body loaded (`messages: []`), and the draft-reuse scan read `messages` — so each
// looked like an untouched draft. The scan must read the persisted count instead.

const AGENT = 'builtin:localix'

const row = (id: string, messageCount: number) => ({
  id,
  projectId: 'P',
  title: 'New Chat',
  sessionKind: 'chat',
  parentSessionId: null,
  isRunning: false,
  messages: [],
  bodyLoaded: false,
  messageCount,
  agents: [{ agentId: AGENT, handle: 'localix' }],
  isPinned: false,
  updatedAt: 0,
})

function harness(allSessions: ReturnType<typeof row>[], activeSessionId: string) {
  let state = {
    projects: [{ id: 'P', isDefault: false }],
    allSessions,
    sessions: allSessions,
    activeProjectId: 'P',
    activeSessionId,
  } as unknown as ChatStore
  const apply = (patch: unknown) => {
    const next = typeof patch === 'function' ? (patch as (s: ChatStore) => object)(state) : patch
    state = { ...state, ...mergeSessionState(state, next as Partial<ChatStore>) } as ChatStore
  }
  const actions = createSessionActions({
    customSet: apply as never,
    get: () => state,
    autoCreateInFlight: new Map(),
  })
  return {
    newChat: () => actions.createSession(undefined, scopedNewConversation('P')),
    active: () => state.activeSessionId,
  }
}

let created = 0
beforeEach(() => {
  created = 0
  spyOn(backendClient, 'createSession').mockImplementation((async () => {
    created += 1
    return { ...row(`new-${created}`, 0), bodyLoaded: true }
  }) as never)
})
afterEach(() => {
  ;(backendClient.createSession as unknown as { mockRestore: () => void }).mockRestore()
})

describe('New chat reuses only a genuinely untouched draft', () => {
  test('repeated clicks from a used chat create ONE new chat and stay on it', async () => {
    const h = harness([row('used-1', 6), row('used-2', 3), row('used-3', 1)], 'used-1')
    const first = await h.newChat()
    const second = await h.newChat()
    const third = await h.newChat()
    expect(created).toBe(1)
    expect([first?.id, second?.id, third?.id]).toEqual(['new-1', 'new-1', 'new-1'])
    expect(h.active()).toBe('new-1')
  })

  test('an untouched draft already in the scope is reused instead of minting another', async () => {
    const h = harness([row('used-1', 6), row('draft', 0)], 'used-1')
    expect((await h.newChat())?.id).toBe('draft')
    expect(created).toBe(0)
  })
})
