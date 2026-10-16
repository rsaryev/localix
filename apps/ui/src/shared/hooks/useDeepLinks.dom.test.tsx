import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import { publishPageOpenChat } from '@/shared/lib/pageOpenChat'
import { registerInspectorHandler, type InspectorRequest } from '@/shared/lib/inspectorBus'
import { resetDesktopInvokeEventsForTests } from '@/shared/lib/tauri'
import { useDeepLinks } from './useDeepLinks'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('the shell handshake opens multiple files in order in the chat on screen, without switching project', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const resolved: string[] = []
  const inspector = spyOn(backendClient, 'inspectPath').mockImplementation(async (path) => {
    resolved.push(path)
    return { kind: 'file', path }
  })
  const shell = window as unknown as {
    __TAURI__?: unknown
    __LOCALIX_DESKTOP?: boolean
  }
  const oldBridge = shell.__TAURI__
  const oldDesktop = shell.__LOCALIX_DESKTOP
  const previousHash = window.location.hash
  const received: InspectorRequest[] = []
  const unregister = registerInspectorHandler((request) => received.push(request))
  let withdraw = publishPageOpenChat(null)
  shell.__LOCALIX_DESKTOP = true
  shell.__TAURI__ = {
    core: {
      invoke: async (command: string) => {
        if (command === 'deep_link_ready') {
          window.__localixDeepLink?.('localix://open?path=%2Fa.json')
          window.__localixDeepLink?.('localix://open?path=%2Fb.json')
        }
      },
    },
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Probe() {
    useDeepLinks()
    return null
  }
  try {
    await act(async () => root.render(createElement(Probe)))
    expect(resolved).toEqual(['/a.json'])
    expect(received).toEqual([])
    withdraw()
    withdraw = publishPageOpenChat('chat-a')
    await act(async () => {})
    expect(resolved).toEqual(['/a.json', '/b.json'])
    expect(received).toEqual([
      { kind: 'file', sessionId: 'chat-a', path: '/a.json' },
      { kind: 'file', sessionId: 'chat-a', path: '/b.json' },
    ])
    // Opening a file never navigates to a project, so the hash is untouched by the opens.
    expect(window.location.hash).toBe(previousHash)
    window.__localixDeepLink?.('localix://session/chat-a')
    expect(window.location.hash).toBe('#/chat/chat-a')
    withdraw()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    inspector.mockRestore()
    unregister()
    withdraw()
    if (oldBridge === undefined) delete shell.__TAURI__
    else shell.__TAURI__ = oldBridge
    if (oldDesktop === undefined) delete shell.__LOCALIX_DESKTOP
    else shell.__LOCALIX_DESKTOP = oldDesktop
    window.location.hash = previousHash
    resetDesktopInvokeEventsForTests()
  }
})
