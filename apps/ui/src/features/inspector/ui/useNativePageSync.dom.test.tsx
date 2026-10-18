import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('a page that moves while its tab is hidden is followed in its own strip', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useNativePageSync } = await import('./useNativePageSync')
  const { usePreviewStore } = await import('../model/previewStore')
  const previous = Object.getOwnPropertyDescriptor(window, '__TAURI__')
  const callbacks = new Map<string, (event: { payload: unknown }) => void>()
  Object.defineProperty(window, '__TAURI__', {
    configurable: true,
    value: {
      event: {
        listen: async (name: string, callback: (event: { payload: unknown }) => void) => {
          callbacks.set(name, callback)
          return () => callbacks.delete(name)
        },
      },
    },
  })
  const emit = (name: string, payload: unknown) => callbacks.get(name)?.({ payload })
  usePreviewStore.setState({
    previewBySession: {},
    previewTabsBySession: {
      'chat-a': [{ previewId: 'shown-page', url: 'https://a.example/', version: 1 }],
      'chat-b': [{ previewId: 'hidden-page', url: 'https://b.example/', version: 1 }],
    },
  })
  function Harness() {
    useNativePageSync()
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Harness />))
    emit('browser:navigated', {
      tabId: 'hidden-page',
      url: 'http://localhost:3000/cb',
      loading: false,
    })
    emit('browser:title', {
      tabId: 'hidden-page',
      url: 'http://localhost:3000/cb',
      title: 'Signed in',
    })
    emit('browser:popup', { tabId: 'hidden-page', url: 'https://popup.example/' })
    emit('browser:navigated', { tabId: 'closed-page', url: 'https://gone.example/' })
    const strips = usePreviewStore.getState().previewTabsBySession
    expect(strips['chat-b']?.[0]).toMatchObject({
      url: 'http://localhost:3000/cb',
      title: 'Signed in',
      nativePage: true,
    })
    expect(strips['chat-b']?.map((tab) => tab.url)).toContain('https://popup.example/')
    expect(strips['chat-a']).toEqual([
      { previewId: 'shown-page', url: 'https://a.example/', version: 1 },
    ])
  } finally {
    await act(async () => root.unmount())
    host.remove()
    usePreviewStore.setState({ previewBySession: {}, previewTabsBySession: {} })
    if (previous) Object.defineProperty(window, '__TAURI__', previous)
    else delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
  }
})
