import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { resetDesktopInvokeEventsForTests } from '@/shared/lib/tauri'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(async () => {
  const { act } = await import('react')
  const { checkDesktopUpdate, dismissUpdateNotice } =
    await import('@/shared/hooks/useDesktopUpdate')
  installBridge(async () => ({ available: false, currentVersion: '0.1.0', latestVersion: null }))
  await act(async () => void (await checkDesktopUpdate()))
  dismissUpdateNotice(null)
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  window.localStorage.clear()
  resetDesktopInvokeEventsForTests()
})

function installBridge(invoke: (command: string) => Promise<unknown>) {
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } }
}

async function publishAvailable(version: string, notes: string | null = null) {
  installBridge(async (command) =>
    command === 'updater_check'
      ? { available: true, currentVersion: '0.1.0', latestVersion: version, notes }
      : undefined,
  )
  const { act } = await import('react')
  const { checkDesktopUpdate } = await import('@/shared/hooks/useDesktopUpdate')
  await act(async () => void (await checkDesktopUpdate()))
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const buttonNamed = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (button) => button.textContent?.trim() === text,
  )

async function mountAnnouncement() {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { UpdateAnnouncement } = await import('./UpdateAnnouncement')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(UpdateAnnouncement)))
  // The dialog body is a lazy chunk: let it resolve.
  await act(async () => {
    await import('./UpdateDialog')
  })
  return async () => {
    await act(async () => root.unmount())
    host.remove()
  }
}

describe('UpdateAnnouncement', () => {
  test('announces a new version once, with both versions and the release notes', async () => {
    const { act } = await import('react')
    await publishAvailable(
      '0.2.0',
      'Faster startup.\n\n### Added\n\n- **Update dialog** for each version',
    )
    const unmount = await mountAnnouncement()

    expect(dialog()?.textContent).toContain('Localix 0.2.0 is ready')
    expect(dialog()?.textContent).toContain('You have 0.1.0')
    // The changelog section arrives as Markdown and is drawn as such, not as raw syntax.
    expect(dialog()?.querySelector('h4')?.textContent).toBe('Added')
    expect(dialog()?.querySelector('li strong')?.textContent).toBe('Update dialog')
    expect(dialog()?.textContent).not.toContain('**')

    await act(async () => buttonNamed('Later')?.click())
    expect(dialog()).toBeNull()
    expect(window.localStorage.getItem('localix.update.announced')).toBe('0.2.0')
    await unmount()

    // The next launch remembers it; a newer version is a new announcement.
    const again = await mountAnnouncement()
    expect(dialog()).toBeNull()
    await publishAvailable('0.3.0')
    expect(dialog()?.textContent).toContain('Localix 0.3.0 is ready')
    await again()
  })

  test('long notes scroll in the dialog’s one viewport instead of growing a box of their own', async () => {
    const entries = Array.from({ length: 60 }, (_, i) => `- **Entry ${i}** \`${'x'.repeat(200)}\``)
    await publishAvailable('0.2.0', ['### Added', '', ...entries].join('\n'))
    const unmount = await mountAnnouncement()

    const content = dialog()
    const scrollers = content?.querySelectorAll('[class*="overflow-y-auto"]') ?? []
    expect(scrollers).toHaveLength(1)
    expect(scrollers[0]?.getAttribute('data-slot')).toBe('dialog-body')
    expect(scrollers[0]?.querySelectorAll('li')).toHaveLength(60)
    // The actions stay outside the scrolling part, so they are always reachable.
    expect(scrollers[0]?.textContent).not.toContain('Restart to update')
    await unmount()
  })

  test('waits while setup is open, then announces', async () => {
    const { act } = await import('react')
    const { openSetup, closeSetup } = await import('@/shared/lib/setupDialog')
    await act(async () => openSetup())
    await publishAvailable('0.2.0')
    const unmount = await mountAnnouncement()
    expect(dialog()).toBeNull()

    await act(async () => closeSetup())
    await act(async () => {
      await import('./UpdateDialog')
    })
    expect(dialog()?.textContent).toContain('Localix 0.2.0 is ready')
    await unmount()
  })

  test('stays quiet without an update and for a version whose notice was hidden', async () => {
    const unmount = await mountAnnouncement()
    expect(dialog()).toBeNull()

    const { act } = await import('react')
    const { dismissUpdateNotice } = await import('@/shared/hooks/useDesktopUpdate')
    await act(async () => dismissUpdateNotice('0.2.0'))
    await publishAvailable('0.2.0')
    expect(dialog()).toBeNull()
    await unmount()
  })
})
