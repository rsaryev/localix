import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Market } from '../../backend/contracts'
import { registerDom } from '@localixai/kit/testing'
import type { MarketTabs } from '../model/useMarketTabs'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const market = (symbol: string, type: Market['type']): Market =>
  ({ symbol, base: symbol, quote: 'USD', type, active: true, contract: type !== 'spot' }) as Market
const ROSTER = [market('BTC', 'spot'), market('ETH-PERP', 'swap')]

/** Both surfaces in miniature: the shared hook feeding the shared strip. */
async function mount() {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useMarketTabs } = await import('../model/useMarketTabs')
  const { MarketTabStrip } = await import('./MarketTabStrip')
  let api!: MarketTabs
  function Harness(props: { markets: Market[]; query: string; resetKey: string }) {
    const tabs = useMarketTabs(props)
    React.useEffect(() => {
      api = tabs
    })
    return <MarketTabStrip tabs={tabs.tabs} active={tabs.tab} onChange={tabs.setTab} />
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (props: { markets: Market[]; query: string; resetKey: string }) =>
    act(async () => root.render(<Harness {...props} />))
  const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const selected = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent
  return {
    act,
    host,
    render,
    tabs,
    selected,
    api: () => api,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('market category tabs (picker + sidebar)', () => {
  test('one tablist with tab + aria-selected semantics and a roving tabindex', async () => {
    const ui = await mount()
    try {
      await ui.render({ markets: ROSTER, query: '', resetKey: 'a' })
      const list = ui.host.querySelector('[role="tablist"]')!
      expect(list.getAttribute('aria-label')).toBe('Market categories')
      expect(ui.host.querySelector('[aria-pressed]')).toBeNull()
      expect(ui.selected()).toBe('All')
      expect(ui.tabs().map((t) => t.tabIndex)).toEqual(ui.tabs().map((_, i) => (i === 0 ? 0 : -1)))
    } finally {
      await ui.unmount()
    }
  })

  test('tabs derive from the UNFILTERED roster only, and a new resetKey collapses them', async () => {
    const ui = await mount()
    try {
      await ui.render({ markets: [], query: '', resetKey: 'a' })
      expect(ui.tabs().map((t) => t.textContent)).toEqual(['All', 'Favourites'])
      await ui.render({ markets: ROSTER, query: '', resetKey: 'a' })
      const derived = ui.tabs().length
      expect(derived).toBeGreaterThan(2)
      // A search narrowing the roster must not make a type tab vanish under the cursor.
      await ui.render({ markets: [ROSTER[0]!], query: 'btc', resetKey: 'a' })
      expect(ui.tabs()).toHaveLength(derived)
      await ui.act(async () => ui.api().setTab('favourites'))
      await ui.render({ markets: [], query: '', resetKey: 'b' })
      expect(ui.tabs().map((t) => t.textContent)).toEqual(['All', 'Favourites'])
      expect(ui.selected()).toBe('All')
    } finally {
      await ui.unmount()
    }
  })

  test('cycling wraps both ways; ArrowRight moves the selection in the strip', async () => {
    const ui = await mount()
    try {
      await ui.render({ markets: [], query: '', resetKey: 'a' })
      await ui.act(async () => ui.api().cycleTab(-1))
      expect(ui.selected()).toBe('Favourites')
      await ui.act(async () => ui.api().cycleTab(1))
      expect(ui.selected()).toBe('All')
      await ui.act(async () => {
        ui.tabs()[0]!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        )
      })
      expect(ui.selected()).toBe('Favourites')
    } finally {
      await ui.unmount()
    }
  })
})
