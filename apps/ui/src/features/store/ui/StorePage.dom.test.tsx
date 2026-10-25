import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { answer, installExtra, listing, SOURCES } from '@/testing/store'
import { stubStoreLayout } from '@/testing/storeLayout'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// `storeApi` is one object for the whole run: a spy left on it is read by the next file.
afterAll(async () => {
  mock.restore()
  await teardown()
})
let withdraw = () => {}
let restoreLayout = () => {}
afterEach(() => {
  withdraw()
  withdraw = () => {}
  restoreLayout()
  document.body.innerHTML = ''
})

const chess = listing({
  id: 'chess',
  displayName: 'Chess',
  version: '1.0.0',
  featured: true,
  contents: { screen: 1 },
  installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
})
const notes = listing({ id: 'notes', displayName: 'Notes' })

async function mountPage(target?: { shelf?: string }) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { MemoryRouter } = await import('react-router')
  const { storeApi } = await import('@/shared/api/store-client')
  spyOn(storeApi, 'page').mockImplementation(async (query) => answer([chess, notes], query ?? {}))
  spyOn(storeApi, 'sources').mockResolvedValue({ sources: SOURCES, addable: ['mini-app'] })
  const { StorePage } = await import('./StorePage')
  restoreLayout = stubStoreLayout(1400)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const until = async (ready: () => boolean) => {
    for (let turn = 0; turn < 100 && !ready(); turn++)
      await React.act(() => new Promise<void>((resolve) => setImmediate(resolve)))
    expect(ready()).toBe(true)
  }
  await React.act(async () =>
    root.render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <StorePage target={target} />
        </SWRConfig>
      </MemoryRouter>,
    ),
  )
  const card = (id: string) => host.querySelector<HTMLElement>(`[data-listing="${id}"]`)
  await until(() => card('chess') !== null)
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
  return { host, card, button, click, until, unmount }
}

describe('the Store tab', () => {
  test('opens on the shelf it was asked for, read from /rpc/store', async () => {
    const page = await mountPage({ shelf: 'package:mini-app' })
    expect(page.host.querySelector('h1')?.textContent).toBe('Store')
    expect(page.host.textContent).toContain('One you install appears in the rail.')
    expect(page.card('notes')?.textContent).toContain('Notes')
    await page.unmount()
  })

  test('without an app of its own here, the Store offers none', async () => {
    const page = await mountPage({ shelf: 'package:mini-app' })
    expect(page.button('Get Notes', page.card('notes')!)).toBeDefined()
    expect(page.button('Install as app: Notes')).toBeUndefined()
    await page.unmount()
  })

  test('with an install extra provided, an installed listing’s page adds one', async () => {
    const React = await import('react')
    const { provideStoreInstallExtra } = await import('@/shared/lib/storeInstallExtra')
    const made: string[] = []
    const { extra } = installExtra({ made, only: ['chess'] })
    withdraw = provideStoreInstallExtra(() => extra)
    const { storeApi } = await import('@/shared/api/store-client')
    const { makeListingDetail } = await import('@localixai/store/testing')
    spyOn(storeApi, 'detail').mockResolvedValue(makeListingDetail(chess))
    const page = await mountPage({ shelf: 'package:mini-app' })
    await page.click(page.button('Chess', page.card('chess')!))
    await page.until(() => page.button('Chess options') !== undefined)
    await React.act(async () => {
      const trigger = page.button('Chess options')!
      trigger.focus()
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const item = () =>
      [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((entry) =>
        entry.textContent?.includes('Add desktop app'),
      )
    await page.until(() => item() !== undefined)
    await page.click(item())
    expect(made).toEqual(['chess'])
    await page.unmount()
  })
})
