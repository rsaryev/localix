import { afterAll, afterEach, beforeAll, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ProviderConnection } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})
afterEach(() => {
  jest.useRealTimers()
})

test('retrying an abandoned browser sign-in returns once to the exact connection', async () => {
  const { act, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useConnections } = await import('./useConnections')
  const { useChatStore } = await import('@/entities/chat/model/store')
  const { backendClient } = await import('@/shared/api/client')
  const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
  const { subscribeModelPicker } = await import('@/shared/lib/modelPickerBus')
  const previousStore = useChatStore.getState()
  const previousInitiate = Object.getOwnPropertyDescriptor(backendClient, 'initiateOAuth')!
  const previousUpdate = Object.getOwnPropertyDescriptor(backendClient, 'updateSession')!
  const previousList = Object.getOwnPropertyDescriptor(backendClient, 'listConnections')!
  const previousHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
  const savedState = sessionStorage.getItem('localix_oauth_state')
  const savedSession = sessionStorage.getItem('localix_oauth_session_id')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const events: unknown[] = []
  // The flow ends by bringing the app back; that call is the signal the sign-in finished.
  let focused!: () => void
  const appFocused = new Promise<void>((resolve) => (focused = resolve))
  const connection: ProviderConnection = {
    id: 'openai-work',
    providerId: 'openai',
    providerName: 'OpenAI',
    label: 'Work',
    authType: 'oauth-pkce',
    hasApiKey: true,
    keyCount: 1,
    keys: [],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  }
  const restorePlatform = configurePlatformCapabilities({
    external: {
      open: (url, systemBrowser) => {
        events.push({ url, systemBrowser })
      },
    },
    desktop: {
      invoke: <T,>(command: string) => {
        events.push(command)
        if (command === 'focus_app') focused()
        return Promise.resolve(undefined as T)
      },
    },
  })
  const unsubscribe = subscribeModelPicker((request) => events.push(request))
  let state!: ReturnType<typeof useConnections>
  function Harness() {
    const connections = useConnections('session-1')
    useEffect(() => {
      state = connections
    })
    return null
  }
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    useChatStore.setState({
      connections: [],
      _replaceSession: () => {},
    })
    // The server is the source of the list: it answers with what the store was told it holds.
    backendClient.listConnections = async () => useChatStore.getState().connections
    let attempt = 0
    backendClient.initiateOAuth = async () => {
      attempt += 1
      // The server can finish login before the initiating request returns to the UI.
      if (attempt === 2) useChatStore.setState({ connections: [connection] })
      return {
        state: `flow-${attempt}`,
        mode: 'local-server',
        redirectUrl: 'https://auth.example.test/',
      }
    }
    backendClient.updateSession = async (sessionId, patch) => {
      events.push({ sessionId, patch })
      return {
        id: sessionId,
        agent: {
          agentId: 'builtin:localix',
          name: 'localix',
          providerConnectionId: connection.id,
          modelId: '',
          reasoningEffort: 'low',
        },
        isRunning: false,
      } as Awaited<ReturnType<typeof backendClient.updateSession>>
    }
    await act(async () => root.render(<Harness />))
    await act(async () => {
      await state.addOAuthConnection('openai', 'OpenAI', 'Abandoned', (id) =>
        events.push(`abandoned:${id}`),
      )
    })
    await act(async () => {
      await state.addOAuthConnection('openai', 'OpenAI', 'Work', (id) => events.push(id))
      // The connection is already listed when the watch starts; the flow's own completion signal.
      await appFocused
    })
    expect(document.hidden).toBe(true)
    expect(events).toEqual([
      { url: 'https://auth.example.test/', systemBrowser: true },
      { url: 'https://auth.example.test/', systemBrowser: true },
      { sessionId: 'session-1', patch: { route: { providerConnectionId: 'openai-work' } } },
      'openai-work',
      { sessionId: 'session-1', providerId: 'openai', connectionId: 'openai-work' },
      'focus_app',
    ])
    expect(sessionStorage.getItem('localix_oauth_state')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    unsubscribe()
    restorePlatform()
    Object.defineProperty(backendClient, 'initiateOAuth', previousInitiate)
    Object.defineProperty(backendClient, 'updateSession', previousUpdate)
    Object.defineProperty(backendClient, 'listConnections', previousList)
    useChatStore.setState(previousStore, true)
    if (previousHidden) Object.defineProperty(document, 'hidden', previousHidden)
    else Reflect.deleteProperty(document, 'hidden')
    for (const [key, value] of [
      ['localix_oauth_state', savedState],
      ['localix_oauth_session_id', savedSession],
    ] as const) {
      if (value === null) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, value)
    }
  }
})
