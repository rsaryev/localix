import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

async function mountEvents(
  deferRegistration = false,
  rejectRegistration = false,
  trackLease = false,
) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useNativePageEvents } = await import('./useNativePageEvents')
  const { nativePageRendererLease } = await import('@/shared/lib/nativePageRendererLease')
  if (trackLease) nativePageRendererLease.claim('page-one')
  const previous = Object.getOwnPropertyDescriptor(window, '__TAURI__')
  const callbacks = new Map<string, Array<(event: { payload: unknown }) => void>>()
  const registrations: Array<() => void> = []
  let unlistened = 0
  Object.defineProperty(window, '__TAURI__', {
    configurable: true,
    value: {
      event: {
        listen: (name: string, callback: (event: { payload: unknown }) => void) => {
          callbacks.set(name, [...(callbacks.get(name) ?? []), callback])
          if (rejectRegistration) return Promise.reject(new Error('Listening unavailable'))
          const off = () => {
            unlistened += 1
          }
          return deferRegistration
            ? new Promise<() => void>((resolve) => registrations.push(() => resolve(off)))
            : Promise.resolve(off)
        },
      },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const received: unknown[] = []
  function Harness({ tabId, label }: { tabId: string; label: string }) {
    useNativePageEvents(tabId, {
      onNavigated: (url, loading, history) =>
        received.push(history ? { label, url, loading, history } : { label, url, loading }),
      onTitle: (title) => received.push({ label, title }),
      onPopup: (popup) => received.push({ label, popup }),
    })
    return null
  }
  const render = (tabId = 'page-one', label = 'initial') =>
    act(async () => root.render(<Harness tabId={tabId} label={label} />))
  await render()
  let unmounted = false
  return {
    received,
    callbacks,
    retire: () => nativePageRendererLease.forget('page-one'),
    render,
    unlistened: () => unlistened,
    emit(name: string, payload: unknown) {
      for (const callback of callbacks.get(name) ?? []) callback({ payload })
    },
    finishRegistrations: () =>
      act(async () => {
        for (const register of registrations.splice(0)) register()
      }),
    unmount: async () => {
      await act(async () => root.unmount())
      unmounted = true
    },
    cleanup: async () => {
      if (!unmounted) await act(async () => root.unmount())
      if (previous) Object.defineProperty(window, '__TAURI__', previous)
      else delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
      host.remove()
      if (trackLease) nativePageRendererLease.forget('page-one')
    },
  }
}

test('queued native popup/navigation/title callbacks cannot act after their page unmounts', async () => {
  const view = await mountEvents()
  try {
    await view.unmount()
    view.emit('browser:popup', { tabId: 'page-one', url: 'https://auth.example/' })
    view.emit('browser:navigated', { tabId: 'page-one', url: 'https://example/new', loading: true })
    view.emit('browser:title', { tabId: 'page-one', title: 'Late title' })
    expect(view.received).toEqual([])
    expect(view.unlistened()).toBe(3)
  } finally {
    await view.cleanup()
  }
})

test('late listener registration unlistens immediately and cannot resurrect a closed page', async () => {
  const view = await mountEvents(true)
  try {
    await view.unmount()
    view.emit('browser:popup', { tabId: 'page-one', url: 'https://auth.example/' })
    await view.finishRegistrations()
    expect(view.unlistened()).toBe(3)
    expect(view.received).toEqual([])
  } finally {
    await view.cleanup()
  }
})

test('logical close rejects queued page events before React cleanup', async () => {
  const view = await mountEvents(false, false, true)
  try {
    view.retire()
    view.emit('browser:popup', { tabId: 'page-one', url: 'https://auth.example/' })
    view.emit('browser:navigated', { tabId: 'page-one', url: 'https://example/', loading: true })
    view.emit('browser:title', { tabId: 'page-one', title: 'Retired title' })
    expect(view.received).toEqual([])
    expect(view.unlistened()).toBe(0)
  } finally {
    await view.cleanup()
  }
})

test('malformed payloads, foreign page IDs and nonweb popups are ignored', async () => {
  const view = await mountEvents()
  try {
    for (const payload of [
      null,
      undefined,
      [],
      3,
      'event',
      { tabId: 4 },
      { tabId: 'page-one', url: {} },
      { tabId: 'page-one', title: {} },
      { tabId: 'page-one', url: 'https://example/', loading: 'yes' },
      { tabId: 'page-one', url: 'https://example/', canGoBack: 'yes' },
      { tabId: 'other', url: 'https://example/' },
      { tabId: 'page-one', url: 'javascript:alert(1)' },
    ]) {
      view.emit('browser:navigated', payload)
      view.emit('browser:title', payload)
      view.emit('browser:popup', payload)
    }
    expect(view.received).toEqual([])
    view.emit('browser:navigated', { tabId: 'page-one', url: 'https://example/', loading: true })
    view.emit('browser:title', { tabId: 'page-one', title: 'Example' })
    view.emit('browser:popup', { tabId: 'page-one', url: 'https://popup.example/' })
    expect(view.received).toEqual([
      { label: 'initial', url: 'https://example/', loading: true },
      { label: 'initial', title: 'Example' },
      { label: 'initial', popup: 'https://popup.example/' },
    ])
  } finally {
    await view.cleanup()
  }
})

test('replacing a page rejects its old callbacks and uses the latest live handlers', async () => {
  const view = await mountEvents()
  try {
    await view.render('page-two', 'new')
    view.emit('browser:popup', { tabId: 'page-one', url: 'https://old.example/' })
    view.emit('browser:popup', { tabId: 'page-two', url: 'https://new.example/' })
    await view.render('page-two', 'updated')
    view.emit('browser:title', { tabId: 'page-two', title: 'Updated' })
    expect(view.received).toEqual([
      { label: 'new', popup: 'https://new.example/' },
      { label: 'updated', title: 'Updated' },
    ])
  } finally {
    await view.cleanup()
  }
})

test('failed native subscriptions report once without an unhandled listener rejection', async () => {
  const { toast } = await import('@/shared/lib/notify')
  const notify = spyOn(toast, 'error').mockImplementation(() => 'test-notification')
  const view = await mountEvents(false, true)
  try {
    expect(notify.mock.calls).toEqual([
      ['Could not follow the browser page', { description: 'Listening unavailable' }],
    ])
  } finally {
    await view.cleanup()
    notify.mockRestore()
  }
})

test('a page that reports its history hands it to the tab with its address', async () => {
  const view = await mountEvents()
  try {
    view.emit('browser:navigated', {
      tabId: 'page-one',
      url: 'https://example/route',
      loading: false,
      canGoBack: true,
      canGoForward: false,
    })
    expect(view.received).toEqual([
      {
        label: 'initial',
        url: 'https://example/route',
        loading: false,
        history: { canGoBack: true, canGoForward: false },
      },
    ])
  } finally {
    await view.cleanup()
  }
})
