import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
// Enter through the store like the app does: the slices sit on an import cycle
// (sessionSync -> store), so loading a slice first evaluates store.ts too early.
import './store'

import { backendClient } from '@/shared/api/client'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'
import { sessionRoute, type ReasoningEffort, type UiSession } from '@/shared/api/contracts'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'
import { createSessionActions } from './sessionActionsSlice'
import { scopedNewConversation } from './conversationStartStrategy'

/** A storage the remembered-choice test can write to; this env has none of its own. */
function mapStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

/** A session's model lives on its participant, so a fixture states a party of one. */
const withParty = (
  providerConnectionId: string,
  modelId: string,
  reasoningEffort: ReasoningEffort = 'low',
) =>
  ({
    id: 's1',
    agents: [
      {
        agentId: 'builtin:localix',
        handle: 'localix',
        providerConnectionId,
        modelId,
        reasoningEffort,
      },
    ],
  }) as UiSession

const baseSession = withParty('connection-old', 'old/model')

let updateSpy: { mockRestore: () => void } | undefined
// A selection persists the choice through the settings store, which debounces the write. Leaving
// that timer armed hands the next test file in the process a write to a server that is not there.
let settingsBefore = useSettingsStore.getState()

beforeEach(() => {
  settingsBefore = useSettingsStore.getState()
})

afterEach(() => {
  const timer = useSettingsStore.getState()._debounceTimer
  if (timer && timer !== settingsBefore._debounceTimer) clearTimeout(timer)
  useSettingsStore.setState(settingsBefore, true)
  updateSpy?.mockRestore()
  updateSpy = undefined
  try {
    localStorage.clear()
  } catch {
    // Storage is optional in the Bun test environment.
  }
})

describe('session model selection', () => {
  test('paints connection and model immediately, then persists one atomic patch', async () => {
    const patches: unknown[] = []
    let resolveUpdate: ((session: UiSession) => void) | undefined
    const update = spyOn(backendClient, 'updateSession').mockImplementation((async (
      _sessionId: string,
      patch: object,
    ) => {
      patches.push(patch)
      return new Promise<UiSession>((resolve) => {
        resolveUpdate = resolve
      })
    }) as never)
    updateSpy = update

    let state = {
      sessions: [baseSession],
      allSessions: [baseSession],
      connections: [{ id: 'connection-new', label: 'New connection' }],
      _replaceSession: (next: UiSession) => {
        state.sessions = state.sessions.map((session) => (session.id === next.id ? next : session))
        state.allSessions = state.allSessions.map((session) =>
          session.id === next.id ? next : session,
        )
      },
      _addSystemNotice: () => {},
    }
    const apply = (patch: unknown) => {
      const next =
        typeof patch === 'function'
          ? (patch as (value: typeof state) => Partial<typeof state>)(state)
          : (patch as Partial<typeof state>)
      state = { ...state, ...next }
    }
    const actions = createSessionActions({
      customSet: apply as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
    })

    const pending = actions.setModelSelection('s1', 'connection-new', 'openai/gpt-5.4')

    expect(update).toHaveBeenCalledTimes(1)
    // The choice names whom it is for — in a private chat, the session's one participant.
    expect(patches).toEqual([
      {
        route: {
          agentId: 'builtin:localix',
          providerConnectionId: 'connection-new',
          modelId: 'openai/gpt-5.4',
        },
      },
    ])
    // The picker reads this state before the PATCH round-trip has completed.
    expect(sessionRoute(state.sessions[0])).toMatchObject({
      providerConnectionId: 'connection-new',
      modelId: 'openai/gpt-5.4',
    })

    resolveUpdate?.(withParty('connection-new', 'openai/gpt-5.4'))
    await pending
  })

  test('switches a model together with its provider-scoped reasoning preference', async () => {
    const patches: unknown[] = []
    const update = spyOn(backendClient, 'updateSession').mockImplementation((async (
      _sessionId: string,
      patch: object,
    ) => {
      patches.push(patch)
      return withParty('connection-new', 'openai/gpt-5.6', 'high')
    }) as never)
    updateSpy = update

    let state = {
      sessions: [baseSession],
      allSessions: [baseSession],
      connections: [{ id: 'connection-new', providerId: 'openai-codex', label: 'OpenAI Codex' }],
      _replaceSession: (next: UiSession) => {
        state.sessions = state.sessions.map((session) => (session.id === next.id ? next : session))
        state.allSessions = state.allSessions.map((session) =>
          session.id === next.id ? next : session,
        )
      },
      _addSystemNotice: () => {},
    }
    const apply = (patch: unknown) => {
      const next =
        typeof patch === 'function'
          ? (patch as (value: typeof state) => Partial<typeof state>)(state)
          : (patch as Partial<typeof state>)
      state = { ...state, ...next }
    }
    const actions = createSessionActions({
      customSet: apply as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
    })

    await actions.setModelSelection('s1', 'connection-new', 'openai/gpt-5.6', 'high')

    expect(patches).toEqual([
      {
        route: {
          agentId: 'builtin:localix',
          providerConnectionId: 'connection-new',
          modelId: 'openai/gpt-5.6',
          reasoningEffort: 'high',
        },
      },
    ])
    expect(sessionRoute(state.sessions[0])).toMatchObject({
      providerConnectionId: 'connection-new',
      modelId: 'openai/gpt-5.6',
      reasoningEffort: 'high',
    })
  })

  test('rolls the optimistic pair back when persistence fails', async () => {
    const update = spyOn(backendClient, 'updateSession').mockRejectedValue(
      new Error('selection failed'),
    )
    updateSpy = update

    let state = {
      sessions: [baseSession],
      allSessions: [baseSession],
      connections: [],
      _replaceSession: () => {},
      _addSystemNotice: () => {},
    }
    const apply = (patch: unknown) => {
      const next =
        typeof patch === 'function'
          ? (patch as (value: typeof state) => Partial<typeof state>)(state)
          : (patch as Partial<typeof state>)
      state = { ...state, ...next }
    }
    const actions = createSessionActions({
      customSet: apply as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
    })

    const pending = actions.setModelSelection('s1', 'connection-new', 'openai/gpt-5.4')
    expect(sessionRoute(state.sessions[0])).toMatchObject({
      providerConnectionId: 'connection-new',
      modelId: 'openai/gpt-5.4',
    })

    let failure: unknown
    try {
      await pending
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('selection failed')
    expect(sessionRoute(state.sessions[0])).toMatchObject({
      providerConnectionId: 'connection-old',
      modelId: 'old/model',
    })
  })

  test.each(['model', 'reasoning'] as const)(
    'serializes a model pick followed by a %s change without stale paint',
    async (change) => {
      const resolvers: Array<(session: UiSession) => void> = []
      const update = spyOn(backendClient, 'updateSession').mockImplementation((async () => {
        return new Promise<UiSession>((resolve) => resolvers.push(resolve))
      }) as never)
      updateSpy = update

      let state = {
        sessions: [baseSession],
        allSessions: [baseSession],
        connections: [],
        _replaceSession: (next: UiSession) => {
          state.sessions = state.sessions.map((session) =>
            session.id === next.id ? next : session,
          )
          state.allSessions = state.allSessions.map((session) =>
            session.id === next.id ? next : session,
          )
        },
        _addSystemNotice: () => {},
      }
      const apply = (patch: unknown) => {
        const next =
          typeof patch === 'function'
            ? (patch as (value: typeof state) => Partial<typeof state>)(state)
            : (patch as Partial<typeof state>)
        state = { ...state, ...next }
      }
      const actions = createSessionActions({
        customSet: apply as never,
        get: () => state as never,
        autoCreateInFlight: new Map(),
      })

      const first = actions.setModelSelection('s1', 'connection-a', 'model-a')
      const second =
        change === 'reasoning'
          ? actions.setReasoningEffort('s1', 'high')
          : actions.setModelSelection('s1', 'connection-b', 'model-b')
      const expectedConnection = change === 'reasoning' ? 'connection-a' : 'connection-b'
      const expectedModel = change === 'reasoning' ? 'model-a' : 'model-b'
      expect(sessionRoute(state.sessions[0])).toMatchObject({
        providerConnectionId: expectedConnection,
        modelId: expectedModel,
        ...(change === 'reasoning' ? { reasoningEffort: 'high' } : {}),
      })
      expect(update).toHaveBeenCalledTimes(1)

      resolvers[0]?.(withParty('connection-a', 'model-a'))
      await first
      expect(update).toHaveBeenCalledTimes(2)
      expect(sessionRoute(state.sessions[0])).toMatchObject({
        providerConnectionId: expectedConnection,
        modelId: expectedModel,
        ...(change === 'reasoning' ? { reasoningEffort: 'high' } : {}),
      })

      resolvers[1]?.(
        withParty(expectedConnection, expectedModel, change === 'reasoning' ? 'high' : 'low'),
      )
      await second
      expect(sessionRoute(state.sessions[0])).toMatchObject({
        providerConnectionId: expectedConnection,
        modelId: expectedModel,
        ...(change === 'reasoning' ? { reasoningEffort: 'high' } : {}),
      })
    },
  )

  test('a failed selection does not restore a participant removed during the request', async () => {
    let rejectUpdate!: (error: Error) => void
    updateSpy = spyOn(backendClient, 'updateSession').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpdate = reject
        }),
    )
    let state = {
      sessions: [baseSession],
      allSessions: [baseSession],
      connections: [],
      _replaceSession: () => {},
      _addSystemNotice: () => {},
    }
    const actions = createSessionActions({
      customSet: ((patch: (value: typeof state) => Partial<typeof state>) => {
        state = { ...state, ...patch(state) }
      }) as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
    })
    const pending = actions.setModelSelection('s1', 'connection-new', 'new/model')
    const remaining = {
      ...baseSession,
      agents: [{ ...baseSession.agents[0]!, agentId: 'builtin:qa', handle: 'qa' }],
    }
    state.sessions = [remaining]
    state.allSessions = [remaining]
    rejectUpdate(new Error('selection failed'))
    await expect(pending).rejects.toThrow('selection failed')
    expect(state.sessions[0]!.agents).toEqual(remaining.agents)
    expect(state.allSessions[0]!.agents).toEqual(remaining.agents)
  })

  test('a new chat states no model and no connection, whatever the browser remembers', async () => {
    // The browser used to carry the pair and re-check the connection id against the live list at
    // each read. localStorage outlives the database, one read site skipped the check, and a
    // connection id from a deleted database reached the server as a 500. The model chain already
    // answers this — the project's default, the route the agent was last on, its card — so the
    // request says nothing and lets it. Values left in storage by an older build must not revive
    // the behaviour, which is what the seeded keys below prove.
    const created: unknown[] = []
    const create = spyOn(backendClient, 'createSession').mockImplementation((async (
      input: object,
    ) => {
      created.push(input)
      return { ...baseSession, id: `new-${created.length}` }
    }) as never)
    installTestLocalStorage(mapStorage())
    try {
      localStorage.setItem('localix_last_model', 'remembered/model')
      localStorage.setItem('localix_last_connection', 'connection-live')

      let state = {
        sessions: [],
        allSessions: [],
        projects: [],
        connections: [{ id: 'connection-live', label: 'Live' }],
        activeProjectId: 'PRJ-1',
        _replaceSession: () => {},
        _addSystemNotice: () => {},
      }
      const actions = createSessionActions({
        customSet: ((patch: unknown) => {
          const next =
            typeof patch === 'function' ? (patch as (v: typeof state) => object)(state) : patch
          state = { ...state, ...(next as Partial<typeof state>) }
        }) as never,
        get: () => state as never,
        autoCreateInFlight: new Map(),
      })

      await actions.createSession(undefined, scopedNewConversation('PRJ-1'))
      expect(created[0]).not.toHaveProperty('modelId')
      expect(created[0]).not.toHaveProperty('providerConnectionId')
      // The positive control: the request is real and still carries what the browser DOES own.
      expect(created[0]).toMatchObject({ projectId: 'PRJ-1' })
    } finally {
      create.mockRestore()
      removeTestLocalStorage()
    }
  })

  test('an unresolved New chat targets the default project, not stale active state', async () => {
    const created: unknown[] = []
    const create = spyOn(backendClient, 'createSession').mockImplementation((async (
      input: object,
    ) => {
      created.push(input)
      return { ...baseSession, id: 'new-default', projectId: 'PRJ-DEFAULT' }
    }) as never)
    let state = {
      sessions: [],
      allSessions: [],
      projects: [{ id: 'PRJ-DEFAULT', isDefault: true }],
      activeProjectId: 'PRJ-STALE',
      activeSessionId: null,
      _replaceSession: () => {},
      _addSystemNotice: () => {},
    }
    const actions = createSessionActions({
      customSet: ((patch: unknown) => {
        const next =
          typeof patch === 'function' ? (patch as (value: typeof state) => object)(state) : patch
        state = { ...state, ...(next as Partial<typeof state>) }
      }) as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
    })

    try {
      await actions.createSession(undefined, scopedNewConversation(null))
      expect(created).toHaveLength(1)
      expect(created[0]).toMatchObject({
        projectId: 'PRJ-DEFAULT',
        agentIds: ['builtin:localix'],
      })
    } finally {
      create.mockRestore()
    }
  })

  test('never reuses another participant’s empty draft', async () => {
    const wrongDraft = {
      ...baseSession,
      id: 'reviewer-draft',
      projectId: 'PRJ-1',
      title: 'New Chat',
      messages: [],
      agents: [
        {
          ...baseSession.agents[0]!,
          agentId: 'builtin:reviewer',
          handle: 'reviewer',
        },
      ],
    } as UiSession
    const create = spyOn(backendClient, 'createSession').mockResolvedValue({
      ...baseSession,
      id: 'localix-draft',
      projectId: 'PRJ-1',
    })
    let state = {
      sessions: [wrongDraft],
      allSessions: [wrongDraft],
      projects: [{ id: 'PRJ-1', isDefault: false }],
      activeProjectId: 'PRJ-1',
      activeSessionId: wrongDraft.id,
      _replaceSession: () => {},
      _addSystemNotice: () => {},
    }
    const actions = createSessionActions({
      customSet: ((patch: unknown) => {
        const next =
          typeof patch === 'function' ? (patch as (value: typeof state) => object)(state) : patch
        state = { ...state, ...(next as Partial<typeof state>) }
      }) as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
    })

    try {
      const result = await actions.createSession(
        undefined,
        scopedNewConversation('PRJ-1', {
          kind: 'agent',
          agentId: 'builtin:localix',
        }),
      )
      expect(result?.id).toBe('localix-draft')
      expect(create).toHaveBeenCalledTimes(1)
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        projectId: 'PRJ-1',
        agentIds: ['builtin:localix'],
      })
    } finally {
      create.mockRestore()
    }
  })
})
