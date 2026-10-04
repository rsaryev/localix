import { describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { createSessionActions } from './sessionActionsSlice'
import { WarmSessionBodyCache } from './sessionBodyCache'

const session = (
  id: string,
  content: string,
  options?: { running?: boolean; updatedAt?: number },
): UiSession =>
  ({
    id,
    title: id,
    projectId: 'PRJ-1',
    isPinned: false,
    isRunning: options?.running ?? false,
    updatedAt: options?.updatedAt ?? 0,
    messages: content ? [{ id: `${id}-message`, role: 'user', content }] : [],
  }) as UiSession

describe('warm session body cache', () => {
  test('enforces both LRU entry count and byte cap', () => {
    const cache = new WarmSessionBodyCache({
      maxEntries: 2,
      maxBytes: 7,
      estimateBytes: (value) => value.messages[0]?.content?.length ?? 0,
    })
    cache.put(session('a', 'aaa'))
    cache.put(session('b', 'bbb'))
    cache.get('a') // a is hottest; b must be the first eviction.
    cache.put(session('c', 'ccc'))

    expect(cache.stats()).toEqual({ entries: 2, bytes: 6, ids: ['a', 'c'] })
    cache.put(session('oversize', '12345678'))
    expect(cache.stats()).toEqual({ entries: 2, bytes: 6, ids: ['a', 'c'] })
  })

  test('switches cache-first, keeps running bodies, then reconciles the fresh body', async () => {
    const cachedA = session('a', 'cached-a', { updatedAt: 1 })
    const summaryB = session('b', '', { updatedAt: 2 })
    const running = session('running', 'live', { running: true, updatedAt: 3 })
    let state = {
      activeSessionId: 'a',
      activeProjectId: null,
      allSessions: [cachedA, summaryB, running],
      sessions: [cachedA, summaryB, running],
      connections: [],
    } as unknown as Record<string, unknown>
    const apply = (patch: unknown) => {
      const next = typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch
      state = { ...state, ...(next as object) }
    }
    const cache = new WarmSessionBodyCache()
    let resolveA!: (value: UiSession) => void
    const freshA = new Promise<UiSession>((resolve) => {
      resolveA = resolve
    })
    const getSession = spyOn(backendClient, 'getSession').mockImplementation((id: string) =>
      id === 'b' ? Promise.resolve(session('b', 'fresh-b', { updatedAt: 2 })) : freshA,
    )
    // Other reducer suites also spy on this shared client; this contract counts
    // only the two selects below, independent of module execution order.
    getSession.mockClear()
    const actions = createSessionActions({
      customSet: apply as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
      sessionBodyCache: cache,
    })
    state = { ...state, ...actions }

    await actions.selectSession('b')
    expect((state.sessions as UiSession[]).find((value) => value.id === 'a')?.bodyLoaded).toBe(
      false,
    )
    const switchingBack = actions.selectSession('a')

    expect(state.activeSessionId).toBe('a')
    expect(
      (state.sessions as UiSession[]).find((value) => value.id === 'a')?.messages[0]?.content,
    ).toBe('cached-a')
    expect(
      (state.sessions as UiSession[]).find((value) => value.id === 'running')?.messages[0]?.content,
    ).toBe('live')

    resolveA(session('a', 'fresh-a', { updatedAt: 4 }))
    await switchingBack
    expect(
      (state.sessions as UiSession[]).find((value) => value.id === 'a')?.messages[0]?.content,
    ).toBe('fresh-a')
    expect(getSession).toHaveBeenCalledTimes(2)
    getSession.mockRestore()
  })

  test('an older uncached detail response cannot steal focus from a newer selection', async () => {
    const summaryA = { ...session('a', ''), bodyLoaded: false }
    const summaryB = { ...session('b', ''), bodyLoaded: false }
    let state = {
      activeSessionId: null,
      activeProjectId: null,
      allSessions: [summaryA, summaryB],
      sessions: [summaryA, summaryB],
      connections: [],
    } as unknown as Record<string, unknown>
    const apply = (patch: unknown) => {
      const next = typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch
      state = { ...state, ...(next as object) }
    }
    let resolveA!: (value: UiSession) => void
    let resolveB!: (value: UiSession) => void
    const detailA = new Promise<UiSession>((resolve) => {
      resolveA = resolve
    })
    const detailB = new Promise<UiSession>((resolve) => {
      resolveB = resolve
    })
    const getSession = spyOn(backendClient, 'getSession').mockImplementation((id: string) =>
      id === 'a' ? detailA : detailB,
    )
    getSession.mockClear()
    const cache = new WarmSessionBodyCache()
    const actions = createSessionActions({
      customSet: apply as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
      sessionBodyCache: cache,
    })
    state = { ...state, ...actions }

    const openingA = actions.selectSession('a')
    const openingB = actions.selectSession('b')
    resolveB({ ...session('b', 'fresh-b'), bodyLoaded: true })
    await openingB
    expect(state.activeSessionId).toBe('b')

    resolveA({ ...session('a', 'fresh-a'), bodyLoaded: true })
    await openingA
    expect(state.activeSessionId).toBe('b')
    expect(cache.stats().ids).toContain('a')
    expect(getSession).toHaveBeenCalledTimes(2)
    getSession.mockRestore()
  })

  test('an aborted route load only warms the cache and cannot activate its retired session', async () => {
    const summaryA = { ...session('a', ''), bodyLoaded: false }
    let state = {
      activeSessionId: 'current',
      activeProjectId: null,
      allSessions: [summaryA],
      sessions: [summaryA],
      connections: [],
    } as unknown as Record<string, unknown>
    const apply = (patch: unknown) => {
      const next = typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch
      state = { ...state, ...(next as object) }
    }
    let resolveA!: (value: UiSession) => void
    const detailA = new Promise<UiSession>((resolve) => {
      resolveA = resolve
    })
    const getSession = spyOn(backendClient, 'getSession').mockImplementation(() => detailA)
    getSession.mockClear()
    const cache = new WarmSessionBodyCache()
    const actions = createSessionActions({
      customSet: apply as never,
      get: () => state as never,
      autoCreateInFlight: new Map(),
      sessionBodyCache: cache,
    })
    state = { ...state, ...actions }
    const controller = new AbortController()

    const openingA = actions.selectSession('a', { signal: controller.signal })
    controller.abort()
    resolveA({ ...session('a', 'fresh-a'), bodyLoaded: true })
    await openingA

    expect(state.activeSessionId).toBe('current')
    expect(cache.stats().ids).toContain('a')
    expect(getSession).toHaveBeenCalledWith('a', controller.signal)
    getSession.mockRestore()
  })
})
