import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { scopePath } from '@/shared/routing/routes'
import { registerDom, removeTestLocalStorage } from '@localixai/kit/testing/dom'
import { createProjectActions } from '@/entities/chat/model/projectActionsSlice'
import { createSessionActions } from '@/entities/chat/model/sessionActionsSlice'
import { mergeSessionState } from '@/entities/chat/model/sessionListHelpers'
import { useChatStore } from '@/entities/chat/model/store'
import type { ChatStore } from '@/entities/chat/model/store'
import { useUrlStoreSync } from './useUrlStoreSync'
import { turns } from '@/testing/settle'

// REPRO: twelve restored workspace windows each remembered a deleted project. Each one left
// the dead route for the neutral home at the same moment, and the home landing minted a
// "New Chat" per window — twelve empty chats in 130 ms, plus one more per window per launch.
// Every window is its own store; only the server can make them agree on one chat.

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
afterEach(() => removeTestLocalStorage())

const draft = (id: string) =>
  ({
    id,
    projectId: 'PRJ-1',
    title: 'New Chat',
    sessionKind: 'chat',
    messages: [],
    bodyLoaded: true,
    messageCount: 0,
    agents: [{ agentId: 'builtin:localix', handle: 'localix' }],
  }) as unknown as UiSession

/** One window's own chat store, as a separate webview has. */
function windowStore() {
  let state = {
    projects: [{ id: 'PRJ-1', isDefault: true }],
    allSessions: [],
    sessions: [],
    activeProjectId: null,
    activeSessionId: null,
  } as unknown as ChatStore
  const apply = (patch: unknown) => {
    const next = typeof patch === 'function' ? (patch as (s: ChatStore) => object)(state) : patch
    state = { ...state, ...mergeSessionState(state, next as Partial<ChatStore>) } as ChatStore
  }
  const sessions = createSessionActions({
    customSet: apply as never,
    get: () => state,
    autoCreateInFlight: new Map(),
  })
  return createProjectActions({
    set: apply as never,
    customSet: apply as never,
    get: () => ({ ...state, createSession: sessions.createSession }) as ChatStore,
  })
}

describe('landing from a dead project route in many windows', () => {
  test('every window converges on the one chat the server finds or creates', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    // The server's find-or-create, serialized as the API serializes it per user.
    let minted = 0
    let existing: UiSession | null = null
    let queue = Promise.resolve()
    const create = spyOn(backendClient, 'createSession').mockImplementation(((input?: {
      reuseEmptyDraft?: boolean
    }) => {
      const answer = queue.then(async () => {
        await Promise.resolve()
        if (input?.reuseEmptyDraft && existing) return existing
        existing = draft(`LOCALIX-${++minted}`)
        return existing
      })
      queue = answer.then(() => undefined)
      return answer
    }) as never)
    const previous = useChatStore.getState()._hasHydrated
    useChatStore.setState({ _hasHydrated: true, projectsLoaded: true })
    const redirects: string[] = []
    const roots = Array.from({ length: 12 }, () => createRoot(document.createElement('div')))
    try {
      await act(async () => {
        for (const root of roots) {
          const { createHomeDraft } = windowStore()
          function HomeAfterDeadRoute() {
            useUrlStoreSync({
              hasHydrated: true,
              nav: { goReplace: (path: string) => redirects.push(path) } as never,
              routeSessionId: null,
              sectionId: null,
              routeProjectId: null,
              isHomeRoute: true,
              // useDeadProjectRoute replaced the URL: a home, not a cold launch index.
              isColdIndex: false,
              activeSessionId: null,
              isMobile: true,
              sidebarOpen: false,
              setSidebarOpen: () => {},
              promptDeepLink: null,
              createHomeDraft,
              selectProject: (async () => {}) as never,
              selectSession: (async () => {}) as never,
              createSession: (async () => null) as never,
            })
            return null
          }
          root.render(<HomeAfterDeadRoute />)
        }
      })
      for (let i = 0; i < 50 && redirects.length < 12; i++) {
        await act(async () => {
          await turns(3)
        })
      }

      expect(create).toHaveBeenCalledTimes(12)
      expect(minted).toBe(1)
      expect(redirects).toEqual(Array.from({ length: 12 }, () => scopePath('PRJ-1', 'LOCALIX-1')))
    } finally {
      await act(async () => {
        for (const root of roots) root.unmount()
      })
      create.mockRestore()
      useChatStore.setState({ _hasHydrated: previous })
    }
  })
})
