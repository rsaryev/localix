import { describe, expect, test, spyOn, beforeEach, afterEach } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { createProjectActions } from './projectActionsSlice'
import { createSessionActions } from './sessionActionsSlice'

// The URL is the single source of truth for the ACTIVE scope. `activeProjectId`
// is a projection of the URL, written ONLY by the URL→store sync via
// selectProject. These tests exercise the reducers directly to prove scope can
// never leak: selectSession must NOT change scope, and opening a project then a
// session in it must KEEP that project (the exact user repro that bounced out of
// the project scope).

interface Sess {
  id: string
  projectId: string
  parentSessionId?: string | null
  messages?: unknown[]
}

let getSessionCallCount = 0
let getSessionSpy: { mockRestore(): void } | null = null

function makeHarness(seed: { projects?: { id: string }[]; allSessions: Sess[] }) {
  let state: Record<string, unknown> = {
    projects: seed.projects ?? [],
    allSessions: seed.allSessions,
    sessions: [],
    activeProjectId: null,
    activeSessionId: null,
    connections: [],
  }
  const get = () => state as never
  const apply = (patch: unknown) => {
    const next = typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch
    state = { ...state, ...(next as object) }
  }
  const project = createProjectActions({
    set: apply as never,
    customSet: apply as never,
    get,
  })
  const session = createSessionActions({
    customSet: apply as never,
    get,
    autoCreateInFlight: new Map(),
  })
  // The reducers call each other via get().selectSession / get().selectProject,
  // so the actions must live on the state object get() returns. The spread in
  // `apply` preserves them across every set.
  state = { ...state, ...project, ...session }
  return {
    selectProject: (id: string | null) =>
      (state.selectProject as (id: string | null) => Promise<void>)(id),
    selectSession: (id: string) => (state.selectSession as (id: string) => Promise<void>)(id),
    scope: () => state.activeProjectId as string | null,
    session: () => state.activeSessionId as string | null,
  }
}

beforeEach(() => {
  getSessionCallCount = 0
  // Clear per-project remembered-session so resolution is deterministic.
  try {
    localStorage.clear()
  } catch {
    /* no storage in this env */
  }
  getSessionSpy = spyOn(backendClient, 'getSession').mockImplementation((async (id: string) => {
    getSessionCallCount += 1
    const byId: Record<string, Sess> = {
      S1: { id: 'S1', projectId: 'P', messages: [] },
      S2: { id: 'S2', projectId: 'P', messages: [] },
      Q1: { id: 'Q1', projectId: 'Q', messages: [] },
    }
    return { ...(byId[id] ?? { id, projectId: 'Q' }), messages: [] } as never
  }) as never)
})

afterEach(() => {
  // `backendClient` is one object for the whole run: a spy left on it counts the next file's calls.
  getSessionSpy?.mockRestore()
  getSessionSpy = null
  try {
    localStorage.clear()
  } catch {
    /* noop */
  }
})

describe('scope is a projection of the URL, never leaked by selectSession', () => {
  test('project selection resolves the route target without prefetching a second session body', async () => {
    const h = makeHarness({
      projects: [{ id: 'P' }],
      allSessions: [
        { id: 'S1', projectId: 'P' },
        { id: 'S2', projectId: 'P' },
      ],
    })

    await h.selectProject('P')

    expect(h.session()).toBe('S1')
    expect(getSessionCallCount).toBe(0)
  })

  test('REPRO: open project P, then click a session in P — scope stays P (no bounce to Global)', async () => {
    const h = makeHarness({
      projects: [{ id: 'P' }],
      allSessions: [
        { id: 'S1', projectId: 'P' },
        { id: 'S2', projectId: 'P' },
      ],
    })

    await h.selectProject('P')
    expect(h.scope()).toBe('P')

    // The sidebar click navigates to /project/P/S2; the URL→store sync then runs
    // selectSession('S2'). This must NOT reset the scope.
    await h.selectSession('S2')
    expect(h.scope()).toBe('P')
    expect(h.session()).toBe('S2')
  })

  test('selectSession never writes activeProjectId — a session detail cannot change scope', async () => {
    const h = makeHarness({
      projects: [{ id: 'P' }, { id: 'Q' }],
      allSessions: [
        { id: 'S1', projectId: 'P' },
        { id: 'Q1', projectId: 'Q' },
      ],
    })

    await h.selectProject('P')
    expect(h.scope()).toBe('P')

    // Even opening a session whose detail claims ANOTHER project must not move the
    // active scope — only selectProject (the URL sync) can. Guards the
    // dual-source-of-truth leak.
    await h.selectSession('Q1')
    expect(h.scope()).toBe('P')
    expect(h.session()).toBe('Q1')
  })

  test('deep-link scope-match: URL /project/P/S1 resolves to project P + session S1', async () => {
    const h = makeHarness({
      projects: [{ id: 'P' }],
      allSessions: [{ id: 'S1', projectId: 'P' }],
    })

    // Mirrors the ChatPage URL→store sync order for a scoped deep link.
    await h.selectProject('P')
    await h.selectSession('S1')
    expect(h.scope()).toBe('P')
    expect(h.session()).toBe('S1')
  })

  test('move between scopes: switching from P to Q lands in Q', async () => {
    const h = makeHarness({
      projects: [{ id: 'P' }, { id: 'Q' }],
      allSessions: [
        { id: 'S1', projectId: 'P' },
        { id: 'Q1', projectId: 'Q' },
      ],
    })

    await h.selectProject('P')
    expect(h.scope()).toBe('P')

    // switchProject('Q') → URL /project/Q → sync runs selectProject('Q'). The scope
    // and its default session must both follow the URL; a scope resolves only its
    // OWN chats, never S1 from project P.
    await h.selectProject('Q')
    expect(h.scope()).toBe('Q')
    expect(h.session()).toBe('Q1')
  })
})

describe('scope survives a session in the OTHER scope (both directions)', () => {
  // The suite above proves a PROJECT scope survives opening a global session. The
  // mirror case matters independently: a reducer that wrote
  // `activeProjectId: detail.projectId ?? state.activeProjectId` would KEEP the
  // project scope (green above) and still leak in the Global direction. Only
  // exercising both directions pins the invariant to "never writes", rather than
  // to "writes something that happens to match".
  test('at scope Q, opening a session that belongs to P stays in Q', async () => {
    const h = makeHarness({
      projects: [{ id: 'P' }, { id: 'Q' }],
      allSessions: [
        { id: 'S1', projectId: 'P' },
        { id: 'Q1', projectId: 'Q' },
      ],
    })

    await h.selectProject('Q')
    expect(h.scope()).toBe('Q')

    await h.selectSession('S1')
    expect(h.scope()).toBe('Q')
    expect(h.session()).toBe('S1')
  })
})
