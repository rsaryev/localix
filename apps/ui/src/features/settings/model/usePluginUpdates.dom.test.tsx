import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('opening the plugins page refreshes the listings once, then reads the last check', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { backendClient } = await import('@/shared/api/client')
  const asked: Array<{ refresh?: boolean } | undefined> = []
  const spy = spyOn(backendClient, 'getPluginUpdates').mockImplementation(async (opts) => {
    asked.push(opts)
    return { available: [], jobs: [], lastCheckedAt: '2026-10-24T00:00:00.000Z' }
  })
  const { usePluginUpdates } = await import('./usePluginUpdates')
  let revalidate: (() => Promise<unknown>) | null = null
  function Probe() {
    const updates = usePluginUpdates()
    revalidate = updates.revalidate
    return <span>{updates.updates?.lastCheckedAt ?? 'loading'}</span>
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Probe />
        </SWRConfig>,
      ),
    )
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(container.textContent).toBe('2026-10-24T00:00:00.000Z')
    await act(async () => void (await revalidate!()))
    expect(asked).toEqual([{ refresh: true }, { refresh: false }])
  } finally {
    await act(async () => root.unmount())
    container.remove()
    spy.mockRestore()
  }
})
