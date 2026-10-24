import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'
import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { registerDom } from '@localixai/kit/testing/dom'
import { provideMiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'
import { provideStoreAppExtra, useStoreAppExtra } from '@/shared/lib/storeAppExtra'
import { registerUi } from './contrib'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
const INSTALLED = ['chess']
afterEach(() => {
  provideStoreAppExtra(() => undefined)
  provideMiniAppDesktopApps(null)
})

test('once mini apps register, the Store offers a mini app with a screen as a desktop app', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  provideMiniAppDesktopApps({
    available: (_name, surfaces) => Boolean(surfaces?.includes('workbench')),
    installed: () => INSTALLED,
    subscribe: () => () => {},
    refresh: () => {},
    install: async () => {},
    remove: async () => {},
  })
  const registered: unknown[] = []
  registerUi(
    new Proxy(
      {},
      {
        get: () => ({ register: (item: unknown) => registered.push(item) }),
      },
    ) as unknown as MiniAppUiHost,
  )
  const seen: (boolean | undefined)[] = []
  const chess = makeListing({ id: 'chess', contents: { screen: 1 } })
  function Probe() {
    const extra = useStoreAppExtra()
    seen.push(extra ? extra.available(chess) && extra.has(chess) : undefined)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await React.act(async () => root.render(<Probe />))
  await React.act(async () => root.unmount())
  expect(registered).toEqual([])
  expect(seen.at(-1)).toBe(true)
})
