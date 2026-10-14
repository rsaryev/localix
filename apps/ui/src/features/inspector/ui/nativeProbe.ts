import { API_BASE_URL, apiFetch } from '@/shared/api/client'
import { tauriInvoke } from '@/shared/lib/tauri'
import type { PreviewEntry } from '../model/preview'
import { nativeProbeUrl } from '../model/nativeProbeUrl'

/**
 * The page-side bridge a native browser tab is driven through: the same Visual Feedback actuator
 * the framed preview carries, injected into the platform WebView on demand.
 */

let source: Promise<string> | null = null
function probeSource(): Promise<string> {
  // Vite proxies /rpc and /desktop in development, not /vf. Fetch this
  // bundle from the API itself; otherwise Vite serves index.html with 200.
  source ??= apiFetch(
    nativeProbeUrl(API_BASE_URL, import.meta.env.DEV, import.meta.env.VITE_API_BASE_URL),
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(`Browser bridge unavailable (${response.status})`)
      if (!response.headers.get('content-type')?.includes('javascript')) {
        throw new Error('Browser bridge endpoint returned HTML instead of JavaScript')
      }
      return response.text()
    })
    .catch((error: unknown) => {
      source = null
      throw error
    })
  return source
}

/** WebKit hands back JSON the page stringified, sometimes stringified once more by the bridge. */
export function decodeEvalResult(value: unknown): unknown {
  let current = value
  for (let n = 0; n < 2 && typeof current === 'string'; n += 1) {
    try {
      current = JSON.parse(current)
    } catch {
      break
    }
  }
  return current
}

interface PageState {
  /** The document's `readyState`. */
  state?: DocumentReadyState
  bridge?: boolean
}

const PAGE_STATE = 'JSON.stringify({state:document.readyState,bridge:!!window.__localixBrowser})'

/**
 * Whether the document in the page has parsed and is the one the tab is loading.
 *
 * With no load in flight (`loading` from `browser_navigation_state`, WebKit's own answer), the
 * document in the page is the tab's. While a load is in flight, WebKit keeps showing the OUTGOING
 * document until the new one commits, and that one has finished: it reads `complete`. A document
 * reading `interactive` has parsed and is still fetching its resources, so it is the incoming one.
 * Waiting for the whole load instead would hold a command for as long as the page's slowest image
 * or ad takes, past the six seconds a command waits.
 */
function documentReady(loading: boolean, page: PageState | null): boolean {
  if (!page?.state || page.state === 'loading') return false
  return !loading || page.state === 'interactive'
}

/**
 * Make sure the document in the page carries the bridge, injecting it when it does not.
 *
 * Readiness used to be inferred by matching `location.href` against the tab's address, and a page
 * that rewrites its own URL with `history.replaceState` (Google adds `zx=` and `#mmc=1` after
 * load) never matched: the page worked, the bridge was never injected, and every command failed
 * after six seconds. It is now the document's own state (`documentReady`).
 */
export async function ensureNativeProbe(tab: PreviewEntry): Promise<void> {
  const invoke = tauriInvoke()
  if (!invoke) throw new Error('Native browser is unavailable')
  const tabId = tab.previewId
  await invoke('browser_open', { tabId, url: tab.url })
  const script = await probeSource()
  let lastState = 'No response from the page'
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const loading = await invoke('browser_navigation_state', { tabId }).then(
      (state) => (state as { loading?: boolean }).loading === true,
      () => false,
    )
    // Named rather than `typeof state`: at the cast, `state` is narrowed to its `null`
    // initializer, so `typeof state` would type every answer as `null`.
    let state: PageState | null = null
    try {
      state = decodeEvalResult(
        await invoke('browser_eval', { tabId, script: PAGE_STATE }),
      ) as PageState | null
    } catch (error) {
      lastState = String(error)
    }
    if (state) lastState = JSON.stringify({ ...state, loading })
    if (!state && attempt === 0) {
      const tiny = await invoke('browser_eval', { tabId, script: '1+1' })
      lastState = `page state=${JSON.stringify(lastState)}, minimal JS=${JSON.stringify(tiny)}`
      if (tiny === '')
        throw new Error(`Browser WebView returned no JavaScript value (${lastState})`)
    }
    const ready = documentReady(loading, state)
    if (ready && state?.bridge) return
    if (ready) {
      const injected = decodeEvalResult(
        await invoke('browser_eval', {
          tabId,
          script: `try { ${script}; JSON.stringify({bridge:!!window.__localixBrowser}) } catch(error) { JSON.stringify({error:String(error)}) }`,
        }),
      ) as { bridge?: boolean; error?: string } | null
      if (injected?.error) throw new Error(`Browser bridge script failed: ${injected.error}`)
      if (injected?.bridge) return
      lastState = JSON.stringify(injected)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Browser page did not initialize its agent bridge (${lastState})`)
}
