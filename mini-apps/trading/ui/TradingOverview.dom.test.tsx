import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import { tradingApi } from './api/tradingApi'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
let unbindDoubles: () => void

beforeAll(() => {
  teardown = registerDom()
  unbindDoubles = bindMiniAppUiTestDoubles()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  unbindDoubles()
  await teardown()
})

test('a failed data-source read is reported with a retry, not hidden behind a dash', async () => {
  // The error branch reset the count to "—" and said nothing about why. Spied rather than
  // served over `fetch`: the catalogue is shared-read and cached, so a suite that already read
  // it would answer from the cache and never fail.
  const exchanges = spyOn(tradingApi, 'exchanges').mockRejectedValue(
    new Error('Venue catalogue is down'),
  )
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { TradingOverview } = await import('./TradingOverview')
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<TradingOverview onOpen={() => {}} />)
      await turns()
    })
    const alert = host.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect([...alert!.querySelectorAll('button')].map((b) => b.textContent)).toContain('Retry')
  } finally {
    await act(async () => root.unmount())
    exchanges.mockRestore()
  }
})
