import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { StatusItemState } from '@localixai/mini-app-sdk/ui'
import { registerDom } from '@localixai/kit/testing/dom'

import { setEnabledPluginNames } from './pluginActivation'
import { registerStatusItem, StatusItems, statusItemsFor } from './statusItems'

/** Every fixture owner, so the activation gate lets them through — see the fail-closed test. */
const FIXTURE_PLUGINS = [
  'fixture',
  'alpha',
  'mid',
  'zeta',
  'aaa',
  'bbb',
  'ccc',
  'over',
  'late',
  'gate',
]

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setEnabledPluginNames(new Set(FIXTURE_PLUGINS))
})

afterAll(async () => {
  setEnabledPluginNames(null)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function render(node: unknown) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node as React.ReactNode))
  return {
    get html() {
      return host.innerHTML
    },
    /**
     * Run a module-store mutation and let its notification reach React. Deliberately NOT a
     * re-render from the test: the point is that the registry's own signal is what updates the bar.
     */
    async mutate(change: () => void) {
      await act(async () => {
        change()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const item = (state: Partial<StatusItemState> & { label: string }): StatusItemState => state

/**
 * Contributed items render in the TITLEBAR and the STATUS BAR — the chrome wrapped around
 * everything else. The failure modes worth testing here are therefore not cosmetic: an item that
 * throws must not take the window with it, an item that appears must not move its neighbours
 * depending on load order, and an item that cannot fit must go somewhere rather than vanish.
 */
describe('contributed status items', () => {
  test('a placement nobody fills renders nothing and disturbs nothing', async () => {
    const view = await render(
      <div data-testid="bar">
        <StatusItems placement="nobody.fills.this" sessionId="s1" />
      </div>,
    )
    try {
      expect(view.html).toContain('data-testid="bar"')
      expect(view.html).not.toContain('<button')
    } finally {
      await view.close()
    }
  })

  test('an unknown placement is silence, not a throw — that is the version promise', async () => {
    // A plugin built against a newer SDK naming a place this host has never heard of must simply
    // not appear. `placement` is an open string for exactly this reason.
    registerStatusItem({
      id: 'fixture:future',
      pluginName: 'fixture',
      placement: 'sidebar.footer.2027',
      useItem: () => item({ label: 'From the future' }),
    })
    const view = await render(<StatusItems placement="titlebar" sessionId="s1" />)
    try {
      expect(view.html).not.toContain('From the future')
    } finally {
      await view.close()
    }
  })

  test('the state a plugin returns is what the host renders', async () => {
    registerStatusItem({
      id: 'fixture:live',
      pluginName: 'fixture',
      placement: 'test.live',
      useItem: (sessionId) =>
        item({
          label: `Session ${sessionId ?? 'none'}`,
          text: 'main',
          metrics: [{ value: '2', label: '2 ahead' }],
          badge: { count: 7 },
          onClick: () => undefined,
        }),
    })
    const view = await render(<StatusItems placement="test.live" sessionId="s1" />)
    try {
      expect(view.html).toContain('main')
      expect(view.html).toContain('2')
      expect(view.html).toContain('7')
      expect(view.html).toContain('aria-label="Session s1"')
    } finally {
      await view.close()
    }
  })

  test('`null` means no control at all, not an empty one', async () => {
    registerStatusItem({
      id: 'fixture:absent',
      pluginName: 'fixture',
      placement: 'test.absent',
      useItem: () => null,
    })
    const view = await render(
      <div data-testid="bar">
        <StatusItems placement="test.absent" sessionId="s1" />
      </div>,
    )
    try {
      expect(view.html).not.toContain('<button')
    } finally {
      await view.close()
    }
  })

  test('nothing contributed shows before the backend confirms the plugin is on', async () => {
    // Fail-closed is the rule for every plugin-owned contribution: until the capability snapshot
    // lands, "not loaded yet" must not be mistaken for "enabled". A status item is chrome, so an
    // item that flashed in and then vanished on the first snapshot would be the most visible
    // possible version of that mistake.
    registerStatusItem({
      id: 'fixture:gated',
      pluginName: 'not-in-the-snapshot',
      placement: 'test.gated',
      useItem: () => item({ label: 'Should not appear' }),
    })
    const view = await render(<StatusItems placement="test.gated" sessionId="s1" />)
    try {
      expect(view.html).not.toContain('Should not appear')
    } finally {
      await view.close()
    }
  })

  test("one declaration renders in every place, on that place's own recipe", async () => {
    // The same state object, three placements. This is what makes a plugin able to show one fact
    // in two rows without writing it twice — Git registers one hook for the titlebar AND the
    // composer, and the two cannot disagree because there is nothing to keep in sync.
    const declaration = () => item({ label: 'Everywhere', text: 'main', onClick: () => undefined })
    for (const placement of ['titlebar', 'composer', 'statusbar'] as const) {
      registerStatusItem({
        id: `fixture:${placement}`,
        pluginName: 'fixture',
        placement,
        useItem: declaration,
      })
      const view = await render(<StatusItems placement={placement} sessionId="s1" />)
      try {
        expect(view.html, placement).toContain('main')
        expect(view.html, placement).toContain('aria-label="Everywhere"')
      } finally {
        await view.close()
      }
    }
  })

  test('order comes from identity, so registration order cannot change it', async () => {
    // Six items from three plugins, registered in a deliberately scrambled order. Sorting on
    // `(pluginName, id)` is what makes the bar look the same however discovery happened to run —
    // and what makes a numeric `order` field unnecessary, along with the race to claim `0`.
    for (const [plugin, suffix] of [
      ['zeta', 'b'],
      ['alpha', 'b'],
      ['zeta', 'a'],
      ['mid', 'a'],
      ['alpha', 'a'],
      ['mid', 'b'],
    ] as const) {
      registerStatusItem({
        id: `${plugin}:${suffix}`,
        pluginName: plugin,
        placement: 'test.order',
        useItem: () => item({ label: `${plugin}-${suffix}` }),
      })
    }
    expect(statusItemsFor('test.order').map((entry) => entry.id)).toEqual([
      'alpha:a',
      'alpha:b',
      'mid:a',
      'mid:b',
      'zeta:a',
      'zeta:b',
    ])
  })

  test('a throwing item removes itself and leaves its neighbours standing', async () => {
    registerStatusItem({
      id: 'aaa:good',
      pluginName: 'aaa',
      placement: 'test.blast',
      useItem: () => item({ label: 'Survivor' }),
    })
    registerStatusItem({
      id: 'bbb:broken',
      pluginName: 'bbb',
      placement: 'test.blast',
      useItem: () => {
        throw new Error('boom in useItem')
      },
    })
    registerStatusItem({
      id: 'ccc:good',
      pluginName: 'ccc',
      placement: 'test.blast',
      useItem: () => item({ label: 'Also fine' }),
    })

    const view = await render(<StatusItems placement="test.blast" sessionId="s1" />)
    try {
      // Without a per-item boundary this throw reaches the app shell and the user sees a blank
      // window instead of one plugin's missing glyph.
      expect(view.html).toContain('Survivor')
      expect(view.html).toContain('Also fine')
    } finally {
      await view.close()
    }
  })

  test('an item that registers after the bar mounted still reaches it', async () => {
    // The regression this exists for: plugin UI chunks are imported once the capability snapshot
    // resolves, which is AFTER the titlebar has painted. The registry is a plain module Map, so
    // without a change signal the strip keeps the answer it got at mount — every contributed glyph
    // registered into a bar that had already decided it had none, and the titlebar stayed empty
    // for the whole session. Nothing in this test re-renders the strip from the outside; the
    // registration itself has to.
    const view = await render(
      <div data-testid="bar">
        <StatusItems placement="test.late" sessionId="s1" />
      </div>,
    )
    try {
      expect(view.html).not.toContain('Arrived late')
      await view.mutate(() =>
        registerStatusItem({
          id: 'late:arrival',
          pluginName: 'late',
          placement: 'test.late',
          useItem: () => item({ label: 'Arrived late' }),
        }),
      )
      expect(view.html).toContain('Arrived late')
    } finally {
      await view.close()
    }
  })

  test('the enabled set landing after the bar mounted also reaches it', async () => {
    // The other half of the same signal, and the shape a RELAUNCH takes: the restored frame
    // publishes the plugins we already believed, so the capability version — which only moves when
    // the set does — never advances. The gate opening has to be news on its own.
    registerStatusItem({
      id: 'gate:item',
      pluginName: 'gate',
      placement: 'test.gate',
      useItem: () => item({ label: 'Gated open' }),
    })
    setEnabledPluginNames(new Set(FIXTURE_PLUGINS.filter((name) => name !== 'gate')))
    const view = await render(<StatusItems placement="test.gate" sessionId="s1" />)
    try {
      expect(view.html).not.toContain('Gated open')
      await view.mutate(() => setEnabledPluginNames(new Set(FIXTURE_PLUGINS)))
      expect(view.html).toContain('Gated open')
    } finally {
      await view.close()
      setEnabledPluginNames(new Set(FIXTURE_PLUGINS))
    }
  })

  test('overflow hands the excess to the host, it never truncates it away', async () => {
    for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f']) {
      registerStatusItem({
        id: `over:${suffix}`,
        pluginName: 'over',
        placement: 'test.overflow',
        useItem: () => item({ label: `item-${suffix}` }),
      })
    }
    const view = await render(
      <StatusItems
        placement="test.overflow"
        sessionId="s1"
        max={4}
        renderOverflow={(hidden) => <span data-hidden={hidden.map((h) => h.id).join(',')} />}
      />,
    )
    try {
      expect(view.html).toContain('item-a')
      expect(view.html).toContain('item-d')
      expect(view.html).not.toContain('item-e')
      // Not dropped — handed over, so the host can put them somewhere reachable.
      expect(view.html).toContain('data-hidden="over:e,over:f"')
    } finally {
      await view.close()
    }
  })
})
