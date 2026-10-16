import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { resetDesktopInvokeEventsForTests } from '@/shared/lib/tauri'

/**
 * "Update & Restart" is a one-shot control: `updater_install` never returns on
 * success, because the process is replaced. So every time the click DOES return,
 * the update did not happen — and the hook used to discard the reason and let the
 * button quietly re-enable, which is the same thing a click that never registered
 * looks like. The comment claimed the failure was "surfaced via the next status
 * check", but that poll is an hour away and only ever re-reports "available".
 */

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(() => teardown())
beforeEach(async () => {
  installBridge(async () => {
    throw new Error('reset test install')
  })
  await (
    await captureApplyUpdate()
  )()
  installBridge(async () => ({ available: false, currentVersion: '0.0.0', latestVersion: null }))
  const { checkDesktopUpdate } = await import('./useDesktopUpdate')
  await checkDesktopUpdate()
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  resetDesktopInvokeEventsForTests()
})

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  // Going through the real bridge advances the module-level invoke trace counter
  // that `tauri.test.ts` asserts absolute ids against. Leave it as we found it.
  resetDesktopInvokeEventsForTests()
})

/** Render the hook through SSR to capture `applyUpdate` without running its polling effects. */
async function captureApplyUpdate() {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { useDesktopUpdate } = await import('./useDesktopUpdate')

  let apply: (() => Promise<unknown>) | undefined
  function Probe() {
    apply = useDesktopUpdate().applyUpdate
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  if (!apply) throw new Error('useDesktopUpdate did not expose applyUpdate')
  return apply
}

function installBridge(invoke: (cmd: string) => Promise<unknown>) {
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } }
}

describe('desktop update apply', () => {
  test('reports the shell’s reason when the install fails', async () => {
    installBridge(async () => {
      throw new Error('signature verification failed')
    })

    const result = await (await captureApplyUpdate())()

    expect(result).toEqual({ ok: false, error: 'signature verification failed' })
  })

  test('reports an unusable bridge instead of returning as if it had applied', async () => {
    // `isDesktop` reads `__TAURI_INTERNALS__` while the invoke bridge reads
    // `__TAURI__` — two different globals, so being in the shell does not imply
    // being able to call it. That gap must produce a message, not a shrug.
    const result = await (await captureApplyUpdate())()

    expect(result).toEqual({
      ok: false,
      error: 'The desktop bridge is unavailable in this window.',
    })
  })

  test('invokes the native installer when the bridge is present', async () => {
    const invoked: string[] = []
    installBridge(async (cmd) => {
      invoked.push(cmd)
      return undefined
    })

    const result = await (await captureApplyUpdate())()

    expect(invoked).toEqual(['updater_install'])
    expect(result).toEqual({ ok: true })
  })
})

describe('desktop update check', () => {
  test('publishes one answer to every reader, so a check from Settings reaches the rail', async () => {
    installBridge(async () => ({
      available: true,
      currentVersion: '1.2.3',
      latestVersion: '1.3.0',
    }))
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { checkDesktopUpdate, useDesktopUpdate } = await import('./useDesktopUpdate')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

    // A reader that does NOT poll, mounted before the check — the Settings row's position.
    let seen: { currentVersion: string } | null = null
    function Probe() {
      seen = useDesktopUpdate({ poll: false }).state
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(createElement(Probe)))
    expect(seen).toMatchObject({ currentVersion: '0.0.0', available: false })

    let result: Awaited<ReturnType<typeof checkDesktopUpdate>> | undefined
    await act(async () => {
      result = await checkDesktopUpdate()
    })
    expect(seen).toMatchObject({ currentVersion: '1.2.3' })
    await act(async () => root.unmount())
    expect(result).toEqual({
      ok: true,
      state: {
        available: true,
        message: 'Update 1.3.0 available',
        latestVersion: '1.3.0',
        currentVersion: '1.2.3',
        installing: false,
      },
    })
  })

  test('does not call a finished check "up to date": a failed one looks the same', async () => {
    installBridge(async () => ({ available: false, currentVersion: '1.2.3', latestVersion: null }))
    const { checkDesktopUpdate } = await import('./useDesktopUpdate')

    const result = await checkDesktopUpdate()
    expect(result.ok && result.state.message).toBe('No newer version found')
  })

  test('reports why a requested check failed', async () => {
    installBridge(async () => {
      throw new Error('updater is not configured')
    })
    const { checkDesktopUpdate } = await import('./useDesktopUpdate')

    expect(await checkDesktopUpdate()).toEqual({ ok: false, error: 'updater is not configured' })
  })
})
