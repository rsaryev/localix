import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
let originalOpen: typeof window.open

// `isDesktop` is resolved ONCE at module load from `__TAURI_INTERNALS__`, so the
// desktop globals have to exist before the dynamic import below. That ordering is
// the whole reason this suite imports inside the tests rather than at the top —
// and why `window` is only touched after `registerDom()` has created it.
beforeAll(() => {
  teardown = registerDom()
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  originalOpen = window.open
})

afterAll(async () => {
  // The desktop globals are process-wide once set. `scripts/test-globals-guard.ts`
  // fails a broad run on a leaked one, and leaving `__TAURI_INTERNALS__` behind
  // would also make every later suite believe it is running inside the shell.
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, '__TAURI_INTERNALS__')
  Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, '__TAURI_INTERNALS__')
  setBridge(null)
  await teardown()
})

type TauriGlobal = {
  core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
}

function setBridge(
  invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null,
) {
  const w = window as unknown as { __TAURI__?: TauriGlobal }
  if (invoke) w.__TAURI__ = { core: { invoke } }
  else delete w.__TAURI__
}

afterEach(() => {
  window.open = originalOpen
  setBridge(null)
})

describe('openExternal', () => {
  test('hands the URL to the native command and does not touch window.open', async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
    setBridge(async (cmd, args) => {
      calls.push({ cmd, args })
      return undefined
    })
    let windowOpenCalls = 0
    window.open = (() => {
      windowOpenCalls += 1
      return null
    }) as typeof window.open

    const { openExternal } = await import('./openExternal')
    openExternal('https://example.com/docs')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toEqual([{ cmd: 'open_external', args: { url: 'https://example.com/docs' } }])
    expect(windowOpenCalls).toBe(0)
  })

  // THE REGRESSION. The native command used to return `()` and log its failures,
  // so this promise always resolved and the fallback below was unreachable code —
  // a refused link did nothing at all, with nothing written anywhere the user
  // could see. It now returns a real `Result`, so a rejection must be handled.
  test('falls back to a browser tab when the native command reports a failure', async () => {
    setBridge(async () => {
      throw new Error('The system handler refused this link: no application knows how to open it')
    })
    const opened: string[] = []
    window.open = ((url?: string | URL) => {
      opened.push(String(url))
      return null
    }) as typeof window.open

    const { openExternal } = await import('./openExternal')
    openExternal('https://example.com/refused')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(opened).toEqual(['https://example.com/refused'])
  })

  // `isDesktop` (via `__TAURI_INTERNALS__`) and `tauriInvoke()` (via `__TAURI__`)
  // read two DIFFERENT globals. When the second is missing the old code fell
  // through to a `window.open` that WKWebView swallows, which is precisely how a
  // link came to look dead. The fallback still runs, but it must not be silent.
  test('still attempts a browser tab when the desktop bridge is missing', async () => {
    setBridge(null)
    const opened: string[] = []
    window.open = ((url?: string | URL) => {
      opened.push(String(url))
      return null
    }) as typeof window.open

    const { openExternal } = await import('./openExternal')
    openExternal('https://example.com/no-bridge')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(opened).toEqual(['https://example.com/no-bridge'])
  })
})
