import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useTauriEvent } from './useTauriEvent'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
})

function installBridge() {
  const handlers = new Map<string, (event: { payload: unknown }) => void>()
  let released = 0
  let resolveListen!: () => void
  const listening = new Promise<void>((resolve) => (resolveListen = resolve))
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    event: {
      listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
        await listening
        handlers.set(name, handler)
        return () => {
          released += 1
          handlers.delete(name)
        }
      },
    },
  }
  return { handlers, released: () => released, resolveListen }
}

test('delivers payloads to the latest handler and releases on unmount', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const bridge = installBridge()
  const seen: string[] = []
  function Host({ tag }: { tag: string }) {
    useTauriEvent('app-toggle', (payload) => seen.push(`${tag}:${String(payload)}`))
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => root.render(<Host tag="a" />))
  await React.act(async () => bridge.resolveListen())
  await React.act(async () => root.render(<Host tag="b" />))
  bridge.handlers.get('app-toggle')?.({ payload: 1 })
  expect(seen).toEqual(['b:1'])
  await React.act(async () => root.unmount())
  expect(bridge.released()).toBe(1)
})

test('an unmount that races the asynchronous listen still releases it', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const bridge = installBridge()
  function Host() {
    useTauriEvent('app-collapse', () => {})
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => root.render(<Host />))
  await React.act(async () => root.unmount())
  await React.act(async () => bridge.resolveListen())
  expect(bridge.released()).toBe(1)
  expect(bridge.handlers.size).toBe(0)
})
