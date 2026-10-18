import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ensureNativeProbe } from './nativeProbe'

let teardown: () => Promise<void>
const previousFetch = globalThis.fetch
beforeAll(() => {
  teardown = registerDom()
  globalThis.fetch = (async () =>
    new Response('/* probe */', {
      headers: { 'content-type': 'text/javascript' },
    })) as unknown as typeof fetch
})
afterAll(async () => {
  globalThis.fetch = previousFetch
  delete (window as { __TAURI__?: unknown }).__TAURI__
  await teardown()
})

const TAB = { previewId: 'page-1', url: 'https://www.google.com/search?q=hi', version: 0 }

interface Moment {
  /** WebKit's answer: a main-frame load is in flight. */
  loading: boolean
  /** What the document in the page says of itself. */
  state: DocumentReadyState
  /** The document began to unload (a link the page followed) — the shell may not know. */
  leaving?: boolean
}

/** A page as WebKit reports it, one moment per poll, settling as a finished load after them. */
function fakePage(moments: Moment[]) {
  let polls = 0
  let bridge = false
  const injections: string[] = []
  const now = (): Moment => moments[polls - 1] ?? { loading: false, state: 'complete' }
  ;(window as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: async (command: string, args?: { script?: string }) => {
        if (command === 'browser_navigation_state') {
          polls += 1
          return { canGoBack: false, canGoForward: false, loading: now().loading }
        }
        if (command !== 'browser_eval') return null
        if (args?.script?.startsWith('try {')) {
          injections.push(`after ${polls} polls`)
          bridge = true
          return JSON.stringify({ bridge })
        }
        return JSON.stringify({ state: now().state, bridge, leaving: now().leaving })
      },
    },
  }
  return { injections }
}

// The regression: readiness was a match between `location.href` and the tab's address, and a
// page that rewrites its URL after load (Google adds `zx=` and `#mmc=1`) never matched — the
// bridge was never injected and the command failed after six seconds on a working page.
test('a settled page gets the bridge whatever address it now shows', async () => {
  const page = fakePage([])
  await ensureNativeProbe(TAB)
  expect(page.injections).toEqual(['after 1 polls'])
})

test('the bridge waits out a load in flight instead of landing in the outgoing document', async () => {
  // The outgoing document finished long ago; until the new one commits, it is what the page shows.
  const outgoing: Moment = { loading: true, state: 'complete' }
  const page = fakePage([outgoing, outgoing])
  await ensureNativeProbe(TAB)
  expect(page.injections).toEqual(['after 3 polls'])
})

test('a page still fetching its resources takes the bridge as soon as it has parsed', async () => {
  const page = fakePage([
    { loading: true, state: 'loading' },
    { loading: true, state: 'interactive' },
  ])
  await ensureNativeProbe(TAB)
  expect(page.injections).toEqual(['after 2 polls'])
})

test('a page leaving by a link of its own is waited out where the shell cannot see the load', async () => {
  // Windows and Linux report no load the page started; the leaving document says so itself.
  const leaving: Moment = { loading: false, state: 'complete', leaving: true }
  const page = fakePage([leaving, leaving])
  await ensureNativeProbe(TAB)
  expect(page.injections).toEqual(['after 3 polls'])
})
