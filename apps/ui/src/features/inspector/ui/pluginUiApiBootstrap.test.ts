import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import type {
  PluginBridgeEventPayload,
  PluginBridgeMessage,
  PluginUiApi,
} from '@localixai/plugin-sdk/ui'

import { PLUGIN_UI_API_BOOTSTRAP } from './pluginUiApiBootstrap'

type MessageListener = (event: { source: unknown; data: unknown }) => void

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('Expected promise to reject')
}

function bootstrapFixture() {
  const listeners: MessageListener[] = []
  const posted: PluginBridgeMessage[] = []
  const attributes = new Map<string, string>([['data-theme', 'dark']])
  const styles = new Map<string, string>()
  const parent = {
    postMessage(message: PluginBridgeMessage) {
      posted.push(message)
    },
  }
  const window = {
    addEventListener(type: string, listener: MessageListener) {
      if (type === 'message') listeners.push(listener)
    },
  } as {
    addEventListener(type: string, listener: MessageListener): void
    acquireLocalixApi?: () => PluginUiApi
  }
  const document = {
    documentElement: {
      style: {
        colorScheme: '',
        setProperty(name: string, value: string) {
          styles.set(name, value)
        },
      },
      getAttribute(name: string) {
        return attributes.get(name) ?? null
      },
      setAttribute(name: string, value: string) {
        attributes.set(name, value)
      },
    },
  }

  runInNewContext(PLUGIN_UI_API_BOOTSTRAP, {
    window,
    parent,
    document,
    console,
    setTimeout,
    clearTimeout,
  })
  const acquire = window.acquireLocalixApi
  if (!acquire) throw new Error('bootstrap did not install acquireLocalixApi')

  return {
    acquire,
    posted,
    attributes,
    styles,
    colorScheme: () => document.documentElement.style.colorScheme,
    dispatch: (data: unknown, source: unknown = parent) => {
      for (const listener of listeners) listener({ source, data })
    },
  }
}

describe('host-injected plugin UI API', () => {
  test('is acquired once, frozen, and posts one idempotent ready handshake', () => {
    const fixture = bootstrapFixture()
    const api = fixture.acquire()

    expect(api.version).toBe(1)
    expect(Object.isFrozen(api)).toBe(true)
    expect(() => fixture.acquire()).toThrow('already been acquired')

    api.ready()
    api.ready()
    expect(fixture.posted).toEqual([{ lx: 'plugin-ui', v: 1, type: 'ready' }])
  })

  test('correlates invoke results and ignores messages not sent by the parent', async () => {
    const fixture = bootstrapFixture()
    const api = fixture.acquire()
    const result = Promise.resolve(api.invoke<{ echoed: boolean }>(' ping ', { hello: 'world' }))
    const request = fixture.posted[0]

    expect(request).toMatchObject({
      lx: 'plugin-ui',
      v: 1,
      type: 'invoke',
      payload: { action: 'ping', payload: { hello: 'world' } },
    })
    fixture.dispatch(
      { lx: 'plugin-ui', v: 1, type: 'result', id: request.id, payload: { echoed: false } },
      {},
    )
    fixture.dispatch({
      lx: 'plugin-ui',
      v: 1,
      type: 'result',
      id: request.id,
      payload: { echoed: true },
    })
    expect(await result).toEqual({ echoed: true })
  })

  test('callBackend uses the same correlated bridge without exposing plugin identity', async () => {
    const fixture = bootstrapFixture()
    const api = fixture.acquire()
    const result = Promise.resolve(api.callBackend<{ ok: boolean }>('dashboard', { page: 2 }))
    const request = fixture.posted[0]!
    expect(request.payload).toEqual({
      action: 'callBackend',
      payload: { action: 'dashboard', payload: { page: 2 } },
    })
    fixture.dispatch({
      lx: 'plugin-ui',
      v: 1,
      type: 'result',
      id: request.id,
      payload: { ok: true },
    })
    expect(await result).toEqual({ ok: true })
  })

  test('rejects malformed actions, host errors, and requests that receive no reply', async () => {
    const fixture = bootstrapFixture()
    const api = fixture.acquire()

    expect(await rejectionMessage(Promise.resolve(api.invoke('   ')))).toContain('non-empty string')

    const failed = Promise.resolve(api.invoke('missing'))
    const failedRequest = fixture.posted.at(-1)!
    fixture.dispatch({
      lx: 'plugin-ui',
      v: 1,
      type: 'error',
      id: failedRequest.id,
      payload: { message: 'Unknown plugin panel action "missing"' },
    })
    expect(await rejectionMessage(failed)).toContain('Unknown plugin panel action')

    expect(
      await rejectionMessage(Promise.resolve(api.invoke('slow', undefined, { timeoutMs: 1 }))),
    ).toContain('timed out after 100ms')
  })

  test('applies themes, publishes safe events, and exposes persisted-state helpers', async () => {
    const fixture = bootstrapFixture()
    const api = fixture.acquire()
    const themes: string[] = []
    const events: PluginBridgeEventPayload[] = []
    api.onTheme((theme) => themes.push(theme.theme))
    api.onEvent((event) => events.push(event))

    fixture.dispatch({
      lx: 'plugin-ui',
      v: 1,
      type: 'theme',
      payload: { theme: 'light', vars: { '--background': '#fff', color: 'ignored' } },
    })
    fixture.dispatch({
      lx: 'plugin-ui',
      v: 1,
      type: 'event',
      payload: { name: 'session', data: { phase: 'run-completed', sessionId: 's1' } },
    })
    expect(api.getTheme()).toBe('light')
    expect(fixture.attributes.get('data-theme')).toBe('light')
    expect(fixture.colorScheme()).toBe('light')
    expect(fixture.styles.get('--background')).toBe('#fff')
    expect(fixture.styles.has('color')).toBe(false)
    expect(themes).toEqual(['light'])
    expect(events).toEqual([{ name: 'session', data: { phase: 'run-completed', sessionId: 's1' } }])

    const getState = Promise.resolve(api.getState<{ count: number }>())
    const getRequest = fixture.posted.at(-1)!
    expect(getRequest.payload).toEqual({ action: 'getViewState', payload: undefined })
    fixture.dispatch({
      lx: 'plugin-ui',
      v: 1,
      type: 'result',
      id: getRequest.id,
      payload: { count: 2 },
    })
    expect(await getState).toEqual({ count: 2 })

    const setState = Promise.resolve(api.setState({ count: 3 }))
    const setRequest = fixture.posted.at(-1)!
    expect(setRequest.payload).toEqual({ action: 'setViewState', payload: { count: 3 } })
    fixture.dispatch({ lx: 'plugin-ui', v: 1, type: 'result', id: setRequest.id })
    expect(await setState).toEqual({ count: 3 })
  })
})
