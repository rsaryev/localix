import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'
import { HOSTED, storeEntry, storePage } from '@/testing/miniAppStore'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// `backendClient` is one object for the whole run: a spy left on it is read by the next file.
afterAll(async () => {
  mock.restore()
  await teardown()
})
afterEach(async () => {
  const { provideMiniAppDesktopApps } = await import('@/shared/lib/miniAppDesktopApps')
  provideMiniAppDesktopApps(null)
  document.body.innerHTML = ''
})

const chess = storeEntry({
  name: 'chess',
  displayName: 'Chess',
  version: '1.0.0',
  surfaces: ['agent', 'workbench'],
  installed: { version: '1.0.0' },
})
const notes = storeEntry({ name: 'notes', displayName: 'Notes' })

/** The shell's desktop apps, as the standalone-app feature offers them, with what was asked. */
function desktopPort(initial: string[] = []) {
  let installed: readonly string[] = initial
  const listeners = new Set<() => void>()
  const calls = { refresh: 0, install: [] as string[][], remove: [] as string[] }
  const port: MiniAppDesktopApps = {
    available: (_name, surfaces) => Boolean(surfaces?.includes('workbench')),
    installed: () => installed,
    subscribe: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    refresh: () => void calls.refresh++,
    install: async (name, title) => void calls.install.push([name, title]),
    remove: async (name) => void calls.remove.push(name),
  }
  /** The shell's list changed (a bundle made, or deleted in Finder). */
  const change = (next: string[]) => {
    installed = next
    for (const listener of listeners) listener()
  }
  return { port, calls, change }
}

async function mountPage() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { backendClient } = await import('@/shared/api/client')
  spyOn(backendClient, 'listMiniAppStore').mockResolvedValue({
    entries: [chess, notes],
    problems: [],
  })
  spyOn(backendClient, 'listMiniAppCatalogs').mockResolvedValue([{ url: HOSTED, builtIn: true }])
  spyOn(backendClient, 'getMiniAppStorePage').mockImplementation(async (name: string) =>
    storePage(name === 'chess' ? chess : notes),
  )
  const { MiniAppStorePage } = await import('./MiniAppStorePage')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  /** Let the store's reads answer: event-loop turns, never a timer. */
  const until = async (ready: () => boolean) => {
    for (let turn = 0; turn < 100 && !ready(); turn++)
      await React.act(() => new Promise<void>((resolve) => setImmediate(resolve)))
    expect(ready()).toBe(true)
  }
  await React.act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MiniAppStorePage />
      </SWRConfig>,
    ),
  )
  const row = (name: string) => host.querySelector<HTMLElement>(`[data-mini-app="${name}"]`)
  await until(() => row('chess') !== null)
  const button = (name: string, scope: ParentNode = document.body) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) =>
        candidate.getAttribute('aria-label') === name ||
        (!candidate.hasAttribute('aria-label') && candidate.textContent?.trim() === name),
    )
  const click = async (element: HTMLElement | undefined) => {
    expect(element).toBeDefined()
    await React.act(async () => element!.click())
  }
  const unmount = () => React.act(async () => root.unmount())
  return { host, row, button, click, until, unmount }
}

describe('the mini app store tab', () => {
  test('opens on its heading and the apps the catalogs offer', async () => {
    const page = await mountPage()
    const heading = page.host.querySelector('h1')
    expect(heading?.textContent).toBe('Mini apps')
    expect(page.host.textContent).toContain('One you install appears in the rail.')
    expect(page.row('chess')?.textContent).toContain('Chess')
    expect(page.row('notes')?.textContent).toContain('Notes')
    await page.unmount()
  })

  test('without desktop apps here, the store offers no app of its own', async () => {
    const page = await mountPage()
    expect(page.button('Install Notes', page.row('notes')!)).toBeDefined()
    expect(page.button('Install Notes as an app', page.row('notes')!)).toBeUndefined()
    await page.click(page.button('Chess', page.row('chess')!))
    await page.until(() => page.host.textContent?.includes('Play a real game') ?? false)
    expect(page.button('Add desktop app')).toBeUndefined()
    await page.unmount()
  })

  test('with the shell’s desktop apps, an installed app’s page adds one and follows the shell', async () => {
    const { provideMiniAppDesktopApps } = await import('@/shared/lib/miniAppDesktopApps')
    const desktop = desktopPort()
    provideMiniAppDesktopApps(desktop.port)
    const page = await mountPage()
    // Shown, the store reads the list again: a bundle can be deleted in Finder at any time.
    expect(desktop.calls.refresh).toBe(1)

    await page.click(page.button('Chess', page.row('chess')!))
    await page.until(() => page.button('Add desktop app') !== undefined)
    await page.click(page.button('Add desktop app'))
    expect(desktop.calls.install).toEqual([['chess', 'Chess']])

    // The shell made it: the page now offers to remove it.
    const { act } = await import('react')
    await act(async () => desktop.change(['chess']))
    expect(page.button('Add desktop app')).toBeUndefined()
    await page.click(page.button('Remove desktop app'))
    expect(desktop.calls.remove).toEqual(['chess'])
    await page.unmount()
  })
})
