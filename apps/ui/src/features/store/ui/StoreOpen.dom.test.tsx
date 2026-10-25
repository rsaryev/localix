import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { answer, listing, SOURCES } from '@/testing/store'
import { stubStoreLayout } from '@/testing/storeLayout'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  mock.restore()
  await teardown()
})
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
  document.body.innerHTML = ''
})

const KIND = 'kanban:board'
const board = listing({
  id: 'kanban',
  displayName: 'Kanban board',
  version: '1.0.0',
  contents: { screen: 1 },
  installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
})

/**
 * The Store as a person meets it, with an installed mini app whose screen is a session-scoped
 * tab (one board per chat) in the rail, and a chat open beside it. Every request the Store sends
 * to the grid is recorded.
 */
async function mountStore(target: { shelf?: string; ref?: unknown }) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { MemoryRouter } = await import('react-router')
  const { storeApi } = await import('@/shared/api/store-client')
  const { makeListingDetail } = await import('@localixai/store/testing')
  spyOn(storeApi, 'page').mockImplementation(async (query) => answer([board], query ?? {}))
  spyOn(storeApi, 'detail').mockResolvedValue(makeListingDetail(board))
  spyOn(storeApi, 'sources').mockResolvedValue({ sources: SOURCES, addable: ['mini-app'] })

  const { miniAppUiHostFor, removeMiniAppUiContributions } = await import('@/shared/contrib/host')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  const { registerUi, withdrawUi } = await import('@/features/mini-app-store/contrib')
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  const { useChatStore } = await import('@/entities/chat/model/store')
  const Nothing = () => null
  const host = miniAppUiHostFor('kanban')
  host.workItems.register({ kind: KIND, Component: Nothing, Icon: Nothing, scope: 'session' })
  host.railViewlets.register({
    kind: KIND,
    title: 'Kanban board',
    label: 'Kanban',
    Icon: Nothing,
    defaultArea: 'bar',
  })
  setEnabledMiniAppNames(new Set(['kanban']))
  registerUi(host)
  const opened: Array<Record<string, unknown>> = []
  const unregister = registerInspectorHandler((request) => void opened.push({ ...request }))
  useChatStore.setState({ activeSessionId: 'chat-1' })
  cleanups.push(() => {
    unregister()
    withdrawUi()
    removeMiniAppUiContributions('kanban')
    setEnabledMiniAppNames(null)
    useChatStore.setState({ activeSessionId: null })
  })

  const { StorePage } = await import('./StorePage')
  cleanups.push(stubStoreLayout(1400))
  const mount = document.createElement('div')
  document.body.append(mount)
  const root = createRoot(mount)
  cleanups.push(() => React.act(async () => root.unmount()))
  await React.act(async () =>
    root.render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <StorePage target={target as never} />
        </SWRConfig>
      </MemoryRouter>,
    ),
  )
  const openButton = () =>
    [...mount.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Open',
    )
  for (let turn = 0; turn < 100 && !openButton(); turn++)
    await React.act(() => new Promise<void>((resolve) => setImmediate(resolve)))
  expect(openButton()).toBeDefined()
  await React.act(async () => openButton()!.click())
  return opened
}

describe('Open on an installed mini app in the Store', () => {
  const expectOpened = (opened: Array<Record<string, unknown>>) =>
    expect(opened).toEqual([
      expect.objectContaining({ kind: 'work-item', workKind: KIND, scope: 'chat-1' }),
    ])

  test('the package page opens its screen in the chat that is open', async () => {
    expectOpened(await mountStore({ ref: { kind: 'mini-app', id: 'kanban' } }))
  })

  test('a tile on the Discover shelf opens it', async () => {
    expectOpened(await mountStore({ shelf: 'package:mini-app' }))
  })
})
