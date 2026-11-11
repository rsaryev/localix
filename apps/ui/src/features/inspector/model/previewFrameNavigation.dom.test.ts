import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { configurePlatformCapabilities } from '@/shared/lib/platformCapabilities'
import { usePreviewStore, type PreviewEntry } from './previewStore'
import { useBrowserHistory } from './browserHistory'
import { registerPreviewFrame, startPreviewFrameNavigation } from './previewFrameNavigation'

/**
 * The desktop shell cancels a preview frame's navigation to a non-loopback page (a sign-in
 * provider) and tells the UI where the frame was going. The UI hands it to the tab whose frame
 * the person is in; anything else goes to the system browser after the person agrees.
 */

const EVENT = 'browser:frame-navigation'
const SIGN_IN = 'https://accounts.example.com/o/oauth2/auth?client_id=app&state=xyz'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

const app: PreviewEntry = { previewId: 'tab-app', url: 'http://localhost:3000/', version: 1 }
const docs: PreviewEntry = { previewId: 'tab-docs', url: 'http://localhost:5173/', version: 1 }
const other: PreviewEntry = { previewId: 'tab-other', url: 'http://localhost:3000/', version: 1 }

let opened: Array<{ url: string; systemBrowser?: boolean }>
let callbacks: Array<(event: { payload: unknown }) => void>
let cleanups: Array<() => void>
let previousTauri: PropertyDescriptor | undefined
const previousPreviews = usePreviewStore.getState()
const previousVisits = useBrowserHistory.getState().visits

beforeEach(() => {
  opened = []
  callbacks = []
  cleanups = []
  previousTauri = Object.getOwnPropertyDescriptor(window, '__TAURI__')
  Object.defineProperty(window, '__TAURI__', {
    configurable: true,
    value: {
      event: {
        listen: (name: string, callback: (event: { payload: unknown }) => void) => {
          if (name === EVENT) callbacks.push(callback)
          return Promise.resolve(() => {
            callbacks = callbacks.filter((item) => item !== callback)
          })
        },
      },
    },
  })
  cleanups.push(
    configurePlatformCapabilities({
      external: { open: (url, systemBrowser) => opened.push({ url, systemBrowser }) },
    }),
  )
  usePreviewStore.setState({
    previewBySession: { 'session-1': app, 'session-2': other },
    previewTabsBySession: { 'session-1': [app, docs], 'session-2': [other] },
  })
})

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup()
  document.body.replaceChildren()
  if (previousTauri) Object.defineProperty(window, '__TAURI__', previousTauri)
  else delete (window as { __TAURI__?: unknown }).__TAURI__
  usePreviewStore.setState({
    previewBySession: previousPreviews.previewBySession,
    previewTabsBySession: previousPreviews.previewTabsBySession,
  })
  useBrowserHistory.setState({ visits: previousVisits })
})

/** A preview frame on screen, as `PreviewTab` mounts and registers it. */
function frameOf(sessionId: string, previewId: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  cleanups.push(registerPreviewFrame({ sessionId, previewId, frame: () => frame }))
  return frame
}

async function started() {
  cleanups.push(startPreviewFrameNavigation())
  // The listener registers asynchronously, as Tauri's does.
  await Promise.resolve()
  expect(callbacks).toHaveLength(1)
  return (payload: unknown) => {
    for (const callback of callbacks) callback({ payload })
  }
}

const tab = (sessionId: string, previewId: string) =>
  usePreviewStore
    .getState()
    .previewTabsBySession[sessionId]?.find((entry) => entry.previewId === previewId)

describe('a preview frame leaving for another site', () => {
  test('switches the tab whose frame the person is in to the native page at that address', async () => {
    const emit = await started()
    frameOf('session-1', 'tab-docs')
    frameOf('session-2', 'tab-other')
    frameOf('session-1', 'tab-app').focus()

    emit({ url: SIGN_IN })

    expect(tab('session-1', 'tab-app')).toMatchObject({ nativePage: true, url: SIGN_IN })
    // The active entry follows its tab, so the strip shows the sign-in page.
    expect(usePreviewStore.getState().previewBySession['session-1']).toMatchObject({
      previewId: 'tab-app',
      nativePage: true,
      url: SIGN_IN,
    })
    // Only that tab: the other frames, in this chat and another, keep their pages.
    expect(tab('session-1', 'tab-docs')).toEqual(docs)
    expect(tab('session-2', 'tab-other')).toEqual(other)
    expect(opened).toEqual([])
  })

  test('asks before the system browser when the person is not in a preview frame', async () => {
    const emit = await started()
    frameOf('session-1', 'tab-app')
    // A link in the chat has the focus, not the frame.
    const link = document.createElement('a')
    link.href = 'https://example.com/'
    document.body.append(link)
    link.focus()

    emit({ url: SIGN_IN })

    expect(tab('session-1', 'tab-app')).toEqual(app)
    expect(opened).toEqual([{ url: SIGN_IN, systemBrowser: true }])
  })

  test('a tab that already shows a native page, or a frame that is gone, is not taken', async () => {
    const emit = await started()
    const native: PreviewEntry = { ...app, nativePage: true }
    usePreviewStore.setState({
      previewBySession: { 'session-1': native },
      previewTabsBySession: { 'session-1': [native, docs] },
    })
    frameOf('session-1', 'tab-app').focus()
    emit({ url: SIGN_IN })
    expect(tab('session-1', 'tab-app')).toEqual(native)

    const frame = frameOf('session-1', 'tab-docs')
    frame.focus()
    // PreviewTab unmounted: its registration is gone with it.
    cleanups.pop()?.()
    emit({ url: 'https://idp.example.org/login' })
    expect(tab('session-1', 'tab-docs')).toEqual(docs)

    expect(opened).toEqual([
      { url: SIGN_IN, systemBrowser: true },
      { url: 'https://idp.example.org/login', systemBrowser: true },
    ])
  })

  test('ignores an address that is not a remote web page', async () => {
    const emit = await started()
    frameOf('session-1', 'tab-app').focus()

    for (const payload of [
      null,
      'https://accounts.example.com/',
      { url: 42 },
      { url: 'not a url' },
      { url: 'javascript:alert(1)' },
      { url: 'file:///etc/passwd' },
      { url: 'localix://open?path=/etc' },
      { url: 'mailto:someone@example.com' },
      // Loopback pages stay in the frame; the shell never hands them over.
      { url: 'http://127.0.0.1:3000/' },
      { url: 'http://localhost:61234/' },
      { url: 'http://[::1]:3000/' },
      // The packaged app's own origin on Windows: no browser page may load it.
      { url: 'http://tauri.localhost/' },
      { url: 'https://TAURI.localhost./index.html' },
    ]) {
      emit(payload)
    }

    expect(tab('session-1', 'tab-app')).toEqual(app)
    expect(opened).toEqual([])
  })

  test('stops listening when stopped', async () => {
    const emit = await started()
    cleanups.pop()?.()
    await Promise.resolve()
    frameOf('session-1', 'tab-app').focus()
    emit({ url: SIGN_IN })
    expect(tab('session-1', 'tab-app')).toEqual(app)
    expect(opened).toEqual([])
  })
})
