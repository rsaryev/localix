import { describe, expect, test } from 'bun:test'
import { invokeMessage, readyMessage } from '@localixai/mini-app-sdk/ui'

import { createPanelActions } from '@/shared/contrib/miniAppPanelActions'
import { createPanelBridgeHost, type PanelWindowLike } from './panelBridgeCore'

/**
 * Host side of the plugin-panel bridge, exercised with a FAKE iframe
 * contentWindow — the protocol contract, minus React and the DOM.
 */

function fakeWindow(): PanelWindowLike & { posted: unknown[] } {
  const posted: unknown[] = []
  return {
    posted,
    postMessage(message: unknown) {
      posted.push(message)
    },
  }
}

const deps = {
  getSessionId: () => 'session-1',
  sendMessage: async () => ({}),
}

function makeHost(win: PanelWindowLike | null, onBridged?: () => void) {
  return createPanelBridgeHost({
    getWindow: () => win,
    actions: createPanelActions(deps),
    context: { pluginName: 'sample-plugin', projectId: '', panelName: 'demo' },
    onBridged,
    getNonce: () => NONCE,
  })
}

const flush = () => new Promise((r) => setTimeout(r, 0))

/** The srcdoc document's bridge nonce, as `buildPanelSrcDoc`'s bootstrap stamps it. */
const NONCE = 'doc-nonce-1'
const stamp = <T extends object>(message: T, nonce: string = NONCE) => ({ ...message, nonce })

describe('createPanelBridgeHost', () => {
  test('ping invoke round-trips a correlated result through the fake window', async () => {
    const win = fakeWindow()
    const host = makeHost(win)
    host.handleMessage({ data: stamp(invokeMessage('req-1', 'ping', { n: 7 })), source: win })
    await flush()
    expect(win.posted).toEqual([
      { lx: 'plugin-ui', v: 1, type: 'result', id: 'req-1', payload: { n: 7 } },
    ])
  })

  test('unknown action replies with a correlated error', async () => {
    const win = fakeWindow()
    const host = makeHost(win)
    host.handleMessage({ data: stamp(invokeMessage('req-2', 'formatDisk')), source: win })
    await flush()
    expect(win.posted).toEqual([
      {
        lx: 'plugin-ui',
        v: 1,
        type: 'error',
        id: 'req-2',
        payload: { message: 'Unknown action "formatDisk"' },
      },
    ])
  })

  test('BACKWARD COMPAT: without a ready handshake there is no bridge', () => {
    const win = fakeWindow()
    let onBridgedFired = false
    const host = makeHost(win, () => {
      onBridgedFired = true
    })
    // A static panel posts nothing; host theme streaming must stay a no-op so
    // the component keeps the legacy snapshot+remount path.
    host.postTheme({ theme: 'light', vars: { '--background': '#fff' } })
    expect(host.isBridged()).toBe(false)
    expect(onBridgedFired).toBe(false)
    expect(win.posted).toEqual([])
  })

  test('ready opts in, then theme updates stream over the bridge', () => {
    const win = fakeWindow()
    let bridgedCalls = 0
    const host = makeHost(win, () => {
      bridgedCalls++
    })
    host.handleMessage({ data: stamp(readyMessage()), source: win })
    host.handleMessage({ data: stamp(readyMessage()), source: win }) // duplicate ready: once
    expect(host.isBridged()).toBe(true)
    expect(bridgedCalls).toBe(1)
    host.postTheme({ theme: 'dark', vars: { '--background': '#000' } })
    expect(win.posted).toEqual([
      {
        lx: 'plugin-ui',
        v: 1,
        type: 'theme',
        payload: { theme: 'dark', vars: { '--background': '#000' } },
      },
    ])
  })

  test('fails CLOSED: wrong source, missing window, and junk are all dropped', async () => {
    const win = fakeWindow()
    const host = makeHost(win)
    host.handleMessage({ data: readyMessage(), source: fakeWindow() }) // spoofed frame
    host.handleMessage({ data: invokeMessage('x', 'ping'), source: {} })
    host.handleMessage({ data: { hello: true }, source: win }) // not a bridge message
    await flush()
    expect(host.isBridged()).toBe(false)
    expect(win.posted).toEqual([])

    const noWin = makeHost(null)
    noWin.handleMessage({ data: readyMessage(), source: null }) // unmounted iframe
    expect(noWin.isBridged()).toBe(false)
  })

  test('postSessionEvent forwards ONLY after ready, and only the phase + session id', () => {
    const win = fakeWindow()
    const host = makeHost(win)
    // Before the ready handshake a session event must NOT cross the bridge.
    host.postSessionEvent('sess-9', 'run-started')
    expect(win.posted).toEqual([])
    // After opt-in it streams as a minimal `event` envelope.
    host.handleMessage({ data: stamp(readyMessage()), source: win })
    host.postSessionEvent('sess-9', 'run-completed')
    expect(win.posted).toEqual([
      {
        lx: 'plugin-ui',
        v: 1,
        type: 'event',
        payload: { name: 'session', data: { phase: 'run-completed', sessionId: 'sess-9' } },
      },
    ])
  })

  test('fire-and-forget invoke (no id) runs the handler but posts no reply', async () => {
    const win = fakeWindow()
    const sent: string[] = []
    const host = createPanelBridgeHost({
      getWindow: () => win,
      actions: createPanelActions({
        getSessionId: () => 's1',
        sendMessage: async (_sessionId, text) => {
          sent.push(text)
          return {}
        },
      }),
      context: { pluginName: 'sample-plugin', projectId: '', panelName: 'demo' },
      getNonce: () => NONCE,
    })
    const msg = invokeMessage('drop-me', 'sendPrompt', { text: 'hi' })
    delete msg.id
    host.handleMessage({ data: stamp(msg), source: win })
    await flush()
    expect(sent).toEqual(['hi'])
    expect(win.posted).toEqual([])
  })

  test('a document navigated into the frame cannot use the bridge without the srcdoc nonce', async () => {
    const win = fakeWindow()
    const sent: string[] = []
    let bridgedCalls = 0
    const host = createPanelBridgeHost({
      getWindow: () => win,
      actions: createPanelActions({
        getSessionId: () => 's1',
        sendMessage: async (_sessionId, text) => {
          sent.push(text)
          return {}
        },
      }),
      context: { pluginName: 'sample-plugin', projectId: '', panelName: 'demo' },
      onBridged: () => bridgedCalls++,
      getNonce: () => NONCE,
    })
    // Same WindowProxy, a different document: it never saw the nonce, or guesses wrong.
    host.handleMessage({ data: readyMessage(), source: win })
    host.handleMessage({ data: invokeMessage('a1', 'sendPrompt', { text: 'probe' }), source: win })
    host.handleMessage({
      data: stamp(invokeMessage('a2', 'sendPrompt', { text: 'probe' }), 'guess'),
      source: win,
    })
    await flush()
    expect(sent).toEqual([])
    expect(bridgedCalls).toBe(0)
    expect(win.posted).toEqual([])

    // A host with no live document nonce fails closed even for a stamped message.
    const unbound = createPanelBridgeHost({
      getWindow: () => win,
      actions: createPanelActions({ getSessionId: () => 's1', sendMessage: async () => ({}) }),
      context: { pluginName: 'sample-plugin', projectId: '', panelName: 'demo' },
      getNonce: () => null,
    })
    unbound.handleMessage({ data: stamp(readyMessage()), source: win })
    expect(unbound.isBridged()).toBe(false)
  })
})
