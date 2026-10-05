import { afterAll, beforeAll, expect, test } from 'bun:test'
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

test('background browser sign-in returns to the exact connection even if persistence is immediate', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useConnections } = await import('./useConnections')
  const { useChatStore } = await import('@/features/chat/model/store')
  const { backendClient } = await import('@/shared/api/client')
  const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
  const { subscribeModelPicker } = await import('@/shared/lib/modelPickerBus')
  const previousStore = useChatStore.getState()
  const previousInitiate = Object.getOwnPropertyDescriptor(backendClient, 'initiateOAuth')!
  const previousUpdate = Object.getOwnPropertyDescriptor(backendClient, 'updateSession')!
  const previousHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
  const savedState = sessionStorage.getItem('localix_oauth_state')
  const savedSession = sessionStorage.getItem('localix_oauth_session_id')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const events: unknown[] = []
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
      open: (url) => {
        events.push(url)
      },
    },
    desktop: {
      invoke: <T,>(command: string) => {
        events.push(command)
        return Promise.resolve(undefined as T)
      },
    },
  })
  const unsubscribe = subscribeModelPicker((request) => events.push(request))
  let state!: ReturnType<typeof useConnections>
  function Harness() {
    state = useConnections('session-1')
    return null
  }
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    useChatStore.setState({
      connections: [],
      refreshConnections: async () => {},
      _replaceSession: () => {},
    })
    backendClient.initiateOAuth = async () => {
      // The server can finish login before the initiating request returns to the UI.
      useChatStore.setState({ connections: [connection] })
      return { state: 'flow-1', mode: 'local-server', redirectUrl: 'https://auth.example.test/' }
    }
    backendClient.updateSession = async (sessionId, patch) => {
      events.push({ sessionId, patch })
      return {
        id: sessionId,
        agents: [
          {
            agentId: 'builtin:localix',
            handle: 'localix',
            providerConnectionId: connection.id,
            modelId: '',
            reasoningEffort: 'low',
          },
        ],
        isRunning: false,
      } as Awaited<ReturnType<typeof backendClient.updateSession>>
    }
    await act(async () => root.render(<Harness />))
    await act(async () => {
      await state.addOAuthConnection('openai', 'OpenAI', 'Work', (id) => events.push(id))
      await new Promise((resolve) => setTimeout(resolve, 3200))
    })
    expect(document.hidden).toBe(true)
    expect(events).toEqual([
      'https://auth.example.test/',
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
}, 15_000)
