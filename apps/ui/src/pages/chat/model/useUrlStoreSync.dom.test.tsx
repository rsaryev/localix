import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { Project, UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { scopePath } from '@/shared/routing/routes'
import {
  installTestLocalStorage,
  registerDom,
  removeTestLocalStorage,
} from '@localixai/kit/testing/dom'
import { useChatStore } from '@/entities/chat/model/store'
import {
  loadLastWorkspace,
  recordChatLocation,
  rememberLastWorkspace,
} from '@/entities/chat/model/persistence'
import { LAUNCH_RESTORE_WAIT_MS } from '@/entities/chat/model/launchRestore'
import { useUrlStoreSync } from './useUrlStoreSync'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('legacy chat route synchronization', () => {
  test('redirects from hydrated summary metadata without downloading the transcript', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const summary = {
      id: 'legacy-session',
      projectId: 'project-a',
      messages: [],
      bodyLoaded: false,
    } as unknown as UiSession
    const previous = useChatStore.getState()
    useChatStore.setState({
      _hasHydrated: true,
      sessions: [],
      allSessions: [summary],
      activeProjectId: null,
      activeSessionId: null,
    })
    const detail = spyOn(backendClient, 'getSession').mockResolvedValue(summary)
    const redirects: string[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    function LegacyRoute() {
      useUrlStoreSync({
        hasHydrated: true,
        nav: { goReplace: (path: string) => redirects.push(path) } as never,
        routeSessionId: summary.id,
        sectionId: null,
        routeProjectId: null,
        isLegacyRoute: true,
        isHomeRoute: false,
        isColdIndex: false,
        activeSessionId: null,
        isMobile: true,
        sidebarOpen: false,
        setSidebarOpen: () => {},
        promptDeepLink: null,
        createHomeDraft: (async () => null) as never,
        selectProject: (async () => {}) as never,
        selectSession: (async () => {}) as never,
        createSession: (async () => summary) as never,
      })
      return null
    }

    try {
      await act(async () => {
        root.render(<LegacyRoute />)
        await Promise.resolve()
      })

      expect(detail).not.toHaveBeenCalled()
      expect(redirects).toEqual([scopePath('project-a', summary.id)])
    } finally {
      await act(async () => root.unmount())
      detail.mockRestore()
      useChatStore.setState({
        _hasHydrated: previous._hasHydrated,
        sessions: previous.sessions,
        allSessions: previous.allSessions,
        activeProjectId: previous.activeProjectId,
        activeSessionId: previous.activeSessionId,
      })
    }
  })
})

// ── Launch-time workspace restore ────────────────────────────────────────────────
//
// The regression under test: `restoreShellFrame()` flips `_hasHydrated` synchronously
// BEFORE the first render, while the projects roster only arrives on its own request. The
// restore used to decide on that first pass, read an empty `projects`, conclude the
// remembered project was gone, and hand over to the home landing — which minted a fresh
// Global chat and, writing its own pair, destroyed the record it had failed to read.

function installStorage() {
  const map = new Map<string, string>()
  installTestLocalStorage({
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  })
  return map
}

const summaryOf = (id: string, projectId: string | null) =>
  ({ id, projectId, messages: [], bodyLoaded: false }) as unknown as UiSession

/** Mount the sync on a COLD bare-index URL (`/`) — the only launch-restore trigger. */
async function mountColdIndex(options: {
  sessions?: UiSession[]
  projects?: Project[]
  projectsLoaded?: boolean
  promptDeepLink?: string | null
  /** What the real home draft also does: write its own pair through the store. */
  onHomeDraft?: () => void
}) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')

  const previous = useChatStore.getState()
  useChatStore.setState({
    _hasHydrated: true,
    sessions: [],
    allSessions: options.sessions ?? [],
    projects: options.projects ?? [],
    projectsLoaded: options.projectsLoaded ?? false,
    activeProjectId: null,
    activeSessionId: null,
  })

  const redirects: string[] = []
  const homeDrafts: number[] = []
  const host = document.createElement('div')
  const root = createRoot(host)

  function ColdIndex() {
    useUrlStoreSync({
      hasHydrated: true,
      nav: { goReplace: (path: string) => redirects.push(path) } as never,
      routeSessionId: null,
      sectionId: null,
      routeProjectId: null,
      isLegacyRoute: false,
      isHomeRoute: true,
      isColdIndex: true,
      activeSessionId: null,
      isMobile: true,
      sidebarOpen: false,
      setSidebarOpen: () => {},
      promptDeepLink: options.promptDeepLink ?? null,
      createHomeDraft: (async () => {
        homeDrafts.push(1)
        options.onHomeDraft?.()
        return null
      }) as never,
      selectProject: (async () => {}) as never,
      selectSession: (async () => {}) as never,
      createSession: (async () => null) as never,
    })
    return null
  }

  await act(async () => {
    root.render(<ColdIndex />)
    await Promise.resolve()
  })

  return {
    redirects,
    homeDrafts,
    /** The projects request answering, mid-flight. */
    landProjects: async (projects: Project[]) => {
      await act(async () => {
        useChatStore.getState()._hydrateProjects(projects)
        await Promise.resolve()
      })
    },
    dispose: async () => {
      await act(async () => root.unmount())
      useChatStore.setState({
        _hasHydrated: previous._hasHydrated,
        sessions: previous.sessions,
        allSessions: previous.allSessions,
        projects: previous.projects,
        projectsLoaded: previous.projectsLoaded,
        activeProjectId: previous.activeProjectId,
        activeSessionId: previous.activeSessionId,
      })
    },
  }
}

describe('launch-time workspace restore', () => {
  afterEach(() => removeTestLocalStorage())

  test('holds the home landing until the projects roster answers, then reopens the project', async () => {
    installStorage()
    rememberLastWorkspace('p1', 's1')
    const view = await mountColdIndex({ sessions: [summaryOf('s1', 'p1')] })
    try {
      // The whole point: nothing was decided and — critically — no draft was minted.
      expect(view.homeDrafts).toEqual([])
      expect(view.redirects).toEqual([])

      await view.landProjects([{ id: 'p1' } as Project])

      expect(view.redirects).toEqual([scopePath('p1')])
      expect(view.homeDrafts).toEqual([])
    } finally {
      await view.dispose()
    }
  })

  test('a roster that never answered in time leaves the record for the next launch', async () => {
    installStorage()
    rememberLastWorkspace('p1', 's1')
    // Capture the bounded wait instead of sleeping through it.
    const realSetTimeout = globalThis.setTimeout
    let expireWait: (() => void) | undefined
    globalThis.setTimeout = ((handler: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === LAUNCH_RESTORE_WAIT_MS) {
        expireWait = handler
        return 0
      }
      return realSetTimeout(handler, ms, ...rest)
    }) as typeof setTimeout
    let view: Awaited<ReturnType<typeof mountColdIndex>> | undefined
    try {
      view = await mountColdIndex({
        sessions: [summaryOf('s1', 'p1')],
        // The fallback landing writes the default project's draft, as the real one does.
        onHomeDraft: () => recordChatLocation('p-default', 'draft'),
      })
      globalThis.setTimeout = realSetTimeout
      const { act } = await import('react')
      await act(async () => {
        expireWait?.()
        await Promise.resolve()
      })

      expect(view.homeDrafts).toEqual([1])
      expect(loadLastWorkspace()).toEqual({ projectId: 'p1', sessionId: 's1' })

      // Once the roster answers, writes mean what they say again.
      await view.landProjects([{ id: 'p1' } as Project])
      recordChatLocation('p2', 's2')
      expect(loadLastWorkspace()).toEqual({ projectId: 'p2', sessionId: 's2' })
    } finally {
      globalThis.setTimeout = realSetTimeout
      await view?.dispose()
    }
  })

  test('a record written before scopes were projects is dropped, not restored', async () => {
    installStorage()
    // `rememberLastWorkspace` refuses to write one; this is a record left on disk by an
    // older build. It addresses a scope that no longer exists, so the launch must fall
    // through to the neutral landing rather than trying to reopen it.
    localStorage.setItem(
      'localix_last_workspace',
      JSON.stringify({ projectId: null, sessionId: 'g1' }),
    )
    const view = await mountColdIndex({ projectsLoaded: true })
    try {
      expect(view.redirects).toEqual([])
      expect(view.homeDrafts).toEqual([1])
    } finally {
      await view.dispose()
    }
  })

  test('falls back to a fresh default-project chat when the remembered project is gone', async () => {
    installStorage()
    rememberLastWorkspace('deleted', 's1')
    const view = await mountColdIndex({ projects: [{ id: 'p1' } as Project], projectsLoaded: true })
    try {
      expect(view.redirects).toEqual([])
      expect(view.homeDrafts).toEqual([1])
    } finally {
      await view.dispose()
    }
  })

  test('nothing remembered lands on the neutral Global home', async () => {
    installStorage()
    const view = await mountColdIndex({ projectsLoaded: true })
    try {
      expect(view.homeDrafts).toEqual([1])
    } finally {
      await view.dispose()
    }
  })

  test('a `?prompt=` deep link outranks the remembered workspace', async () => {
    installStorage()
    rememberLastWorkspace('p1', 's1')
    const view = await mountColdIndex({
      projects: [{ id: 'p1' } as Project],
      projectsLoaded: true,
      promptDeepLink: 'ship it',
    })
    try {
      expect(view.redirects).toEqual([])
      expect(view.homeDrafts).toEqual([1])
    } finally {
      await view.dispose()
    }
  })
})

describe('home landing', () => {
  afterEach(() => removeTestLocalStorage())

  test('a slow home draft does not pull back a person who already opened another chat', async () => {
    installStorage()
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const previous = useChatStore.getState()
    const opened = summaryOf('s2', 'p2')
    useChatStore.setState({
      _hasHydrated: true,
      sessions: [],
      allSessions: [opened],
      projects: [{ id: 'p2' } as Project],
      projectsLoaded: true,
      activeProjectId: 'p2',
      activeSessionId: 's2',
    })
    let finishDraft: (session: UiSession) => void = () => {}
    const draft = new Promise<UiSession>((resolve) => (finishDraft = resolve))
    const redirects: string[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    function Route({ home }: { home: boolean }) {
      useUrlStoreSync({
        hasHydrated: true,
        nav: { goReplace: (path: string) => redirects.push(path) } as never,
        routeSessionId: home ? null : 's2',
        sectionId: null,
        routeProjectId: home ? null : 'p2',
        isLegacyRoute: false,
        isHomeRoute: home,
        isColdIndex: false,
        activeSessionId: home ? null : 's2',
        isMobile: true,
        sidebarOpen: false,
        setSidebarOpen: () => {},
        promptDeepLink: null,
        createHomeDraft: (() => draft) as never,
        selectProject: (async () => {}) as never,
        selectSession: (async () => {}) as never,
        createSession: (async () => null) as never,
      })
      return null
    }

    try {
      await act(async () => {
        root.render(<Route home />)
        await Promise.resolve()
      })
      // The person clicks a chat in the sidebar while the draft is still being created.
      await act(async () => {
        root.render(<Route home={false} />)
        await Promise.resolve()
      })
      await act(async () => {
        finishDraft(summaryOf('draft', 'p-default'))
        await draft
      })
      expect(redirects).not.toContain(scopePath('p-default', 'draft'))
    } finally {
      await act(async () => root.unmount())
      useChatStore.setState({
        _hasHydrated: previous._hasHydrated,
        sessions: previous.sessions,
        allSessions: previous.allSessions,
        projects: previous.projects,
        projectsLoaded: previous.projectsLoaded,
        activeProjectId: previous.activeProjectId,
        activeSessionId: previous.activeSessionId,
      })
    }
  })
})
