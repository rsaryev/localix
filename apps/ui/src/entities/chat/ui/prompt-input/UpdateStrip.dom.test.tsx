import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { resetDesktopInvokeEventsForTests } from '@/shared/lib/tauri'
import type { DesktopUpdateState } from '@/shared/hooks/useDesktopUpdate'
import type { Listing } from '@localixai/store'
import { makeListing } from '@localixai/store/testing'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(async () => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  // The hidden version lives in the module as well as in storage: reset both.
  ;(await import('@/shared/hooks/useDesktopUpdate')).dismissUpdateNotice(null)
  window.localStorage.clear()
  resetDesktopInvokeEventsForTests()
})

const available: DesktopUpdateState = {
  available: true,
  message: 'Update 0.2.0 available',
  latestVersion: '0.2.0',
  currentVersion: '0.1.0',
  notes: null,
  installing: false,
  percent: null,
}

const buttonNamed = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text || button.getAttribute('aria-label') === text,
  )

async function mount(node: () => React.ReactElement) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node()))
  return {
    host,
    rerender: (next: () => React.ReactElement) => act(async () => root.render(next())),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('UpdateRow', () => {
  test('offers the one action, with both versions, and a way to hide it', async () => {
    const { createElement } = await import('react')
    const { UpdateRow } = await import('./UpdateStrip')
    let installs = 0
    let dismissals = 0
    const view = await mount(() =>
      createElement(UpdateRow, {
        state: available,
        onInstall: () => (installs += 1),
        onDismiss: () => (dismissals += 1),
      }),
    )
    expect(view.host.textContent).toContain('Update available')
    expect(view.host.textContent).toContain('Localix 0.2.0')
    expect(view.host.textContent).toContain('you have 0.1.0')
    buttonNamed(view.host, 'Restart to update')?.click()
    buttonNamed(view.host, 'Hide until the next version')?.click()
    expect([installs, dismissals]).toEqual([1, 1])
    await view.unmount()
  })

  test('while installing it reports progress and offers nothing to press or hide', async () => {
    const { createElement } = await import('react')
    const { UpdateRow } = await import('./UpdateStrip')
    const view = await mount(() =>
      createElement(UpdateRow, {
        state: { ...available, installing: true, message: 'Downloading update… 42%' },
        onInstall: () => {},
        onDismiss: () => {},
      }),
    )
    expect(view.host.textContent).toContain('Updating')
    expect(view.host.textContent).toContain('Downloading update… 42%')
    expect(buttonNamed(view.host, 'Restart to update')).toBeUndefined()
    expect(view.host.querySelector('button')).toBeNull()
    expect(view.host.querySelector('[role="status"]')).not.toBeNull()
    await view.unmount()
  })
})

describe('UpdateStrip', () => {
  function installBridge(invoke: (command: string) => Promise<unknown>) {
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } }
  }

  /** The shell reports `available`; the strip reads it through the shared state. */
  async function publishAvailable(version = '0.2.0', onInstall?: () => Promise<unknown>) {
    installBridge(async (command) => {
      if (command === 'updater_check') {
        return { available: true, currentVersion: '0.1.0', latestVersion: version }
      }
      if (command === 'updater_install') return onInstall?.()
      return undefined
    })
    const { act } = await import('react')
    const { checkDesktopUpdate } = await import('@/shared/hooks/useDesktopUpdate')
    await act(async () => void (await checkDesktopUpdate()))
  }

  test('shows in the focused composer only, and nowhere without an update', async () => {
    const { createElement } = await import('react')
    const { UpdateStrip } = await import('./UpdateStrip')
    const { checkDesktopUpdate } = await import('@/shared/hooks/useDesktopUpdate')
    installBridge(async () => ({ available: false, currentVersion: '0.1.0', latestVersion: null }))
    await checkDesktopUpdate()
    const none = await mount(() => createElement(UpdateStrip, { isFocused: true }))
    expect(none.host.textContent).toBe('')
    await none.unmount()

    await publishAvailable()
    const focused = await mount(() => createElement(UpdateStrip, { isFocused: true }))
    const idle = await mount(() => createElement(UpdateStrip, { isFocused: false }))
    expect(focused.host.textContent).toContain('Update available')
    expect(idle.host.textContent).toBe('')
    await focused.unmount()
    await idle.unmount()
  })

  test('hiding it is remembered for that version, and a newer version shows it again', async () => {
    const { createElement } = await import('react')
    const { act } = await import('react')
    const { UpdateStrip } = await import('./UpdateStrip')
    await publishAvailable('0.2.0')
    const view = await mount(() => createElement(UpdateStrip, { isFocused: true }))
    await act(async () => buttonNamed(view.host, 'Hide until the next version')?.click())
    expect(view.host.textContent).toBe('')
    expect(window.localStorage.getItem('localix.update.dismissed')).toBe('0.2.0')

    await publishAvailable('0.3.0')
    expect(view.host.textContent).toContain('Localix 0.3.0')
    await view.unmount()
  })

  test('pressing it starts the install, shows it running, and returns when it fails', async () => {
    const { createElement } = await import('react')
    const { act } = await import('react')
    const { UpdateStrip } = await import('./UpdateStrip')
    // The click loads the confirmation flow lazily; load it first so the click only waits on turns.
    await import('../../model/restartToUpdateFlow')
    let fail: (reason: Error) => void = () => {}
    await publishAvailable('0.2.0', () => new Promise((_, reject) => (fail = reject)))
    const view = await mount(() => createElement(UpdateStrip, { isFocused: true }))
    await act(async () => {
      buttonNamed(view.host, 'Restart to update')?.click()
      // The confirmation flow is loaded on the click; with nothing running it installs at once.
      await turns()
    })
    expect(view.host.textContent).toContain('Updating')
    expect(buttonNamed(view.host, 'Restart to update')).toBeUndefined()

    await act(async () => {
      fail(new Error('signature verification failed'))
      await turns()
    })
    expect(view.host.textContent).toContain('Update available')
    expect(buttonNamed(view.host, 'Restart to update')).toBeDefined()
    await view.unmount()
  })
})

describe('UpdateStrip with other updates on offer', () => {
  /** Servers whose Store offers two mini app updates. */
  async function offerMiniAppUpdates() {
    const { storeApi } = await import('@/shared/api/store-client')
    const { localModelsApi } = await import('@/shared/api/localModelsApi')
    const spies = [
      spyOn(storeApi, 'activity').mockResolvedValue({
        jobs: [],
        updates: [
          {
            ref: { kind: 'mini-app', id: 'sample-chess' },
            displayName: 'Chess',
            from: '1.0.0',
            to: '1.1.0',
          },
          {
            ref: { kind: 'mini-app', id: 'sample-reader' },
            displayName: 'Reader',
            from: '0.3.0',
            to: '0.4.0',
          },
        ],
      }),
      spyOn(localModelsApi, 'status').mockResolvedValue({
        jobs: [],
        paused: [],
        installed: [],
        running: [],
      } as never),
      ...(await recommend([])),
    ]
    return () => spies.forEach((spy) => spy.mockRestore())
  }

  /** What the Store recommends for the work: these listings, all of them found by meaning. */
  async function recommend(listings: Listing[]) {
    const { storeApi } = await import('@/shared/api/store-client')
    return [
      spyOn(storeApi, 'reportWorkingSet').mockResolvedValue(undefined),
      spyOn(storeApi, 'recommendations').mockResolvedValue({
        listings,
        matched: listings.length,
        strategy: { mode: 'hybrid' },
        pending: false,
      }),
    ]
  }

  async function mountStrip() {
    const { createElement, act } = await import('react')
    const { SWRConfig } = await import('swr')
    const { UpdateStrip } = await import('./UpdateStrip')
    const view = await mount(() =>
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        createElement(UpdateStrip, { isFocused: true }),
      ),
    )
    await act(async () => turns())
    return view
  }

  test('without an app update, the Store’s updates are offered', async () => {
    const restore = await offerMiniAppUpdates()
    const { checkDesktopUpdate } = await import('@/shared/hooks/useDesktopUpdate')
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async () => ({ available: false, currentVersion: '0.1.0', latestVersion: null }),
      },
    }
    await checkDesktopUpdate()
    const view = await mountStrip()
    expect(view.host.textContent).toContain('2 mini app updates')
    expect(view.host.textContent).toContain('Chess and Reader')
    await view.unmount()
    restore()
  })

  test('with no update on offer, the strip says what the Store recommends for the work', async () => {
    const { storeApi } = await import('@/shared/api/store-client')
    const { localModelsApi } = await import('@/shared/api/localModelsApi')
    const spies = [
      spyOn(storeApi, 'activity').mockResolvedValue({ jobs: [], updates: [] }),
      spyOn(localModelsApi, 'status').mockResolvedValue({
        jobs: [],
        paused: [],
        installed: [],
        running: [],
      } as never),
      ...(await recommend([
        makeListing({ id: 'docker', kind: 'plugin', displayName: 'Docker tools' }),
      ])),
    ]
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async () => ({ available: false, currentVersion: '0.1.0', latestVersion: null }),
      },
    }
    const { checkDesktopUpdate } = await import('@/shared/hooks/useDesktopUpdate')
    await checkDesktopUpdate()
    const view = await mountStrip()
    expect(view.host.textContent).toContain('Recommended for you')
    expect(view.host.textContent).toContain('Docker tools suit what you work on')
    await view.unmount()
    spies.forEach((spy) => spy.mockRestore())
  })

  test('the app’s own update always wins the strip', async () => {
    const restore = await offerMiniAppUpdates()
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async () => ({ available: true, currentVersion: '0.1.0', latestVersion: '0.2.0' }),
      },
    }
    const { checkDesktopUpdate } = await import('@/shared/hooks/useDesktopUpdate')
    await checkDesktopUpdate()
    const view = await mountStrip()
    expect(view.host.textContent).toContain('Update available')
    expect(view.host.textContent).not.toContain('mini app updates')
    await view.unmount()
    restore()
  })
})
