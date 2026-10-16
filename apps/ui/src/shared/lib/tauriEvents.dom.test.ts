import { registerDom } from '@localixai/kit/testing/dom'
import { afterAll, beforeAll, afterEach, expect, test } from 'bun:test'
import { tauriListen } from './tauri'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})
afterEach(() => {
  delete window.__LOCALIX_WORKSPACE
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
})

test('workspace events are scoped while updater events stay app-wide', async () => {
  const calls: Array<{ event: string; options: unknown }> = []
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    event: {
      listen: async (event: string, _handler: unknown, options: unknown) => {
        calls.push({ event, options })
        return () => {}
      },
    },
  }
  window.__LOCALIX_WORKSPACE = { id: 'workspace-0123456789abcdef', route: null }
  const listen = tauriListen()!
  await listen('browser:navigated', () => {})
  await listen('localix://before-quit', () => {})
  await listen('tauri://resize', () => {})
  await listen('updater:progress', () => {})
  expect(calls).toEqual([
    {
      event: 'browser:navigated',
      options: { target: { kind: 'Webview', label: 'workspace-0123456789abcdef' } },
    },
    {
      event: 'localix://before-quit',
      options: { target: { kind: 'Webview', label: 'workspace-0123456789abcdef' } },
    },
    {
      event: 'tauri://resize',
      options: { target: { kind: 'Window', label: 'workspace-0123456789abcdef' } },
    },
    { event: 'updater:progress', options: undefined },
  ])
})

test('a legacy bridge keeps its default subscriptions', async () => {
  let received: unknown = 'unset'
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    event: {
      listen: async (_event: string, _handler: unknown, options: unknown) => {
        received = options
        return () => {}
      },
    },
  }
  await tauriListen()!('browser:title', () => {})
  expect(received).toBeUndefined()
})
