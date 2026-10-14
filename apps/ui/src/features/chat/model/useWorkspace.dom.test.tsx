import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('workspace startup recovery', () => {
  test('a transient first failure reads as still-starting, never as an error', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SWRConfig } = await import('swr')
    const { backendClient } = await import('@/shared/api/client')
    const { useWorkspace } = await import('./useWorkspace')
    const { useChatStore, useHasHydrated } = await import('./store')

    let attempt = 0
    const connections = spyOn(backendClient, 'listConnections').mockImplementation(async () => {
      return []
    })
    const sessions = spyOn(backendClient, 'listSessions').mockImplementation(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('connection refused')
      return []
    })
    const projects = spyOn(backendClient, 'listProjects').mockImplementation(async () => {
      return []
    })

    useChatStore.setState({
      _hasHydrated: false,
      connections: [],
      allSessions: [],
      sessions: [],
      projects: [],
      activeProjectId: null,
      activeSessionId: null,
    })

    function StartupSurface() {
      const workspace = useWorkspace()
      const hydrated = useHasHydrated()
      return (
        <main data-testid="startup-shell">
          {hydrated ? 'Workspace ready' : workspace.error ? 'Retrying local service…' : 'Starting…'}
        </main>
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <StartupSurface />
        </SWRConfig>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(host.querySelector('[data-testid="startup-shell"]')).not.toBeNull()
    // A packaged desktop start races a sidecar that is still binding its port.
    // One refused connection is that race, not a workspace failure — surfacing it
    // produced a red strip that vanished a moment later on every cold launch.
    expect(host.textContent).toContain('Starting…')
    expect(useChatStore.getState()._hasHydrated).toBe(false)
    expect(sessions).toHaveBeenCalledTimes(1)

    // The first retry is 100 ms. Once the local service becomes reachable, the
    // authoritative workspace snapshot flips the hydration gate without a reload.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180))
    })

    expect(sessions).toHaveBeenCalledTimes(2)
    // Optional slices succeeded on their first independent attempt; retrying the
    // core roster does not refetch work that already converged.
    expect(connections).toHaveBeenCalledTimes(1)
    expect(projects).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState()._hasHydrated).toBe(true)
    expect(host.textContent).toContain('Workspace ready')

    await act(async () => root.unmount())
    host.remove()
    connections.mockRestore()
    sessions.mockRestore()
    projects.mockRestore()
  })

  test('a service that never answers surfaces the failure once the dense window is spent', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SWRConfig } = await import('swr')
    const { backendClient } = await import('@/shared/api/client')
    const { useWorkspace } = await import('./useWorkspace')
    const { useChatStore, useHasHydrated } = await import('./store')

    const sessions = spyOn(backendClient, 'listSessions').mockImplementation(async () => {
      throw new Error('connection refused')
    })
    const connections = spyOn(backendClient, 'listConnections').mockResolvedValue([])
    const projects = spyOn(backendClient, 'listProjects').mockResolvedValue([])

    useChatStore.setState({
      _hasHydrated: false,
      connections: [],
      allSessions: [],
      sessions: [],
      projects: [],
      activeProjectId: null,
      activeSessionId: null,
    })

    function StartupSurface() {
      const workspace = useWorkspace()
      const hydrated = useHasHydrated()
      return (
        <main>
          {hydrated ? 'Workspace ready' : workspace.error ? 'Retrying local service…' : 'Starting…'}
        </main>
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <StartupSurface />
        </SWRConfig>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    // Still calm after the first refusal — the fix under test.
    expect(host.textContent).toContain('Starting…')

    // Backoff runs 100/200/400 ms; four failures clear the patience threshold.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
    })

    expect(sessions.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(host.textContent).toContain('Retrying local service')

    await act(async () => root.unmount())
    host.remove()
    sessions.mockRestore()
    connections.mockRestore()
    projects.mockRestore()
  })

  test('an optional connection slice failure does not hold core workspace readiness', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SWRConfig } = await import('swr')
    const { backendClient } = await import('@/shared/api/client')
    const { useWorkspace } = await import('./useWorkspace')
    const { useChatStore, useHasHydrated } = await import('./store')

    let connectionAttempt = 0
    const connections = spyOn(backendClient, 'listConnections').mockImplementation(async () => {
      connectionAttempt += 1
      if (connectionAttempt === 1) throw new Error('provider store temporarily unavailable')
      return []
    })
    const sessions = spyOn(backendClient, 'listSessions').mockResolvedValue([])
    const projects = spyOn(backendClient, 'listProjects').mockResolvedValue([])

    useChatStore.setState({
      _hasHydrated: false,
      connections: [],
      allSessions: [],
      sessions: [],
      projects: [],
      activeProjectId: null,
      activeSessionId: null,
    })

    function Surface() {
      useWorkspace()
      return <main>{useHasHydrated() ? 'Core ready' : 'Connecting'}</main>
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Surface />
        </SWRConfig>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(host.textContent).toContain('Core ready')
    expect(useChatStore.getState()._hasHydrated).toBe(true)
    expect(sessions).toHaveBeenCalledTimes(1)
    expect(connections).toHaveBeenCalledTimes(1)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180))
    })
    expect(connections).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    host.remove()
    connections.mockRestore()
    sessions.mockRestore()
    projects.mockRestore()
  })

  test('leaves automatic route detail loading to URL sync but refreshes it explicitly', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SWRConfig } = await import('swr')
    const { backendClient } = await import('@/shared/api/client')
    const { useWorkspace } = await import('./useWorkspace')
    const { useChatStore } = await import('./store')

    const summaryFixture = {
      id: 'session-one',
      title: 'Session one',
      messages: [],
      bodyLoaded: false,
      projectId: 'PRJ-1',
      isPinned: false,
      isRunning: false,
      updatedAt: 1,
    }
    const summary = summaryFixture as never
    const detail = {
      ...summaryFixture,
      messages: [{ id: 'message-one', role: 'user', content: 'Loaded once' }],
      bodyLoaded: true,
    } as never
    const sessions = spyOn(backendClient, 'listSessions').mockResolvedValue([summary])
    const connections = spyOn(backendClient, 'listConnections').mockResolvedValue([])
    const projects = spyOn(backendClient, 'listProjects').mockResolvedValue([])
    const getSession = spyOn(backendClient, 'getSession').mockResolvedValue(detail)
    getSession.mockClear()

    useChatStore.setState({
      _hasHydrated: true,
      connections: [],
      allSessions: [summary],
      sessions: [summary],
      projects: [],
      activeProjectId: 'PRJ-1',
      activeSessionId: 'session-one',
    })

    let reload!: () => Promise<void>
    function Surface() {
      reload = useWorkspace().mutate
      return <main>Workspace</main>
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Surface />
        </SWRConfig>,
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // Mounting the active-session SWR key used to race the route owner's
    // selectSession() with a second getSession request.
    expect(getSession).toHaveBeenCalledTimes(0)

    await act(async () => {
      await reload()
    })
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[0]?.bodyLoaded).toBe(true)

    await act(async () => root.unmount())
    host.remove()
    sessions.mockRestore()
    connections.mockRestore()
    projects.mockRestore()
    getSession.mockRestore()
  })
})
