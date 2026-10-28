import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
let unbindDoubles: () => void
let originalFetch: typeof fetch

beforeAll(() => {
  teardown = registerDom()
  // The workspace renders host surfaces and this suite has no host. Binding the SDK's doubles here
  // rather than inheriting them keeps it from passing only when another suite bound them first.
  unbindDoubles = bindMiniAppUiTestDoubles()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = url.endsWith('/exchanges')
      ? { exchanges: [] }
      : url.includes('/markets')
        ? { markets: [] }
        : url.endsWith('/connections')
          ? { connections: [] }
          : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterAll(async () => {
  unbindDoubles()
  globalThis.fetch = originalFetch
  await teardown()
})

describe('Trading Workspace navigation', () => {
  test('keeps an area mounted after switching away and back', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TradingWorkspace } = await import('./TradingWorkspace')
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<TradingWorkspace sessionId="session-a" requestedArea="overview" />)
        await Promise.resolve()
      })
      expect(host.textContent).toContain('Research-first safety boundary')

      const marketsButton = host.querySelector<HTMLButtonElement>('button[title="Markets"]')
      expect(marketsButton).not.toBeNull()
      await act(async () => {
        marketsButton?.click()
        await turns()
      })
      // Embedded, the market pane no longer repeats the section name in a panel header —
      // the workspace toolbar's active segment already carries it — so the pane identifies
      // itself by its own controls.
      expect(host.textContent).toContain('Data source')

      const search = host.querySelector<HTMLInputElement>('input[placeholder="Search markets…"]')
      expect(search).not.toBeNull()

      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[title="Overview"]')?.click()
      })
      expect(host.textContent).toContain('Research-first safety boundary')

      await act(async () => {
        marketsButton?.click()
      })
      expect(host.querySelector<HTMLInputElement>('input[placeholder="Search markets…"]')).toBe(
        search,
      )
    } finally {
      await act(async () => root.unmount())
    }
  })
})
