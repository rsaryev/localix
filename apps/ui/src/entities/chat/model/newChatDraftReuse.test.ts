import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
// Enter through the store like the app does: the slices sit on an import cycle
// (sessionSync -> store), so loading a slice first evaluates store.ts too early.
import './store'
import type { UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { composerDrafts } from '@/shared/lib/composerDrafts'
import { createSessionActions } from './sessionActionsSlice'
import { createProjectActions } from './projectActionsSlice'
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
  agent: { agentId: AGENT, handle: 'localix' },
  isPinned: false,
  updatedAt: 0,
})

function harness(
  allSessions: readonly (UiSession | ReturnType<typeof row>)[],
  activeSessionId: string,
) {
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
  const projectActions = createProjectActions({
    set: apply as never,
    customSet: apply as never,
    get: () => ({ ...state, createSession: actions.createSession }) as ChatStore,
  })
  return {
    newChat: () => actions.createSession(undefined, scopedNewConversation('P')),
    land: () => projectActions.createHomeDraft(),
    active: () => state.activeSessionId,
    roster: () => state.allSessions,
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
  composerDrafts.forget('new-1')
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

  test('a saved empty chat from an older workspace is never reused', async () => {
    const h = harness([row('used-1', 6), row('draft', 0)], 'used-1')
    expect((await h.newChat())?.id).toBe('new-1')
    expect(created).toBe(1)
  })

  test('simultaneous clicks join one creation and commit one roster row', async () => {
    const h = harness([row('used', 2)], 'used')
    const results = await Promise.all([h.newChat(), h.newChat(), h.newChat()])
    expect(created).toBe(1)
    expect(results.map((session) => session?.id)).toEqual(['new-1', 'new-1', 'new-1'])
    expect(h.roster().filter((session) => session.id === 'new-1')).toHaveLength(1)
  })

  test('unsent input stays in its chat and New chat opens a clean draft', async () => {
    const h = harness([row('used', 2)], 'used')
    await h.newChat()
    composerDrafts.set('new-1', 'unfinished question')
    expect((await h.newChat())?.id).toBe('new-2')
    expect(composerDrafts.get('new-1')).toBe('unfinished question')
    expect(composerDrafts.get('new-2')).toBe('')
    expect(created).toBe(2)
  })

  test('another window sees a new draft but never reuses it as its own', async () => {
    const firstWindow = harness([row('used', 2)], 'used')
    await firstWindow.newChat()
    const secondWindow = harness(firstWindow.roster(), 'used')
    expect((await secondWindow.newChat())?.id).toBe('new-2')
    expect((await firstWindow.newChat())?.id).toBe('new-1')
    expect(created).toBe(2)
  })
})

describe('a landing asks the server for any untouched chat', () => {
  const requests = () =>
    (backendClient.createSession as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      ([input]) => input as { reuseEmptyDraft?: boolean },
    )

  test('the home landing (launch, dead project route) requests find-or-create', async () => {
    const h = harness([row('used', 2)], 'used')
    await h.land()
    expect(requests().map((input) => input.reuseEmptyDraft)).toEqual([true])
  })

  test('the New chat gesture never asks to reuse', async () => {
    const h = harness([row('used', 2)], 'used')
    await h.newChat()
    expect(requests().map((input) => input.reuseEmptyDraft)).toEqual([undefined])
  })
})
