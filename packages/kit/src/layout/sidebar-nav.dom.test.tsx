import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Compass, Package, Plug } from 'lucide-react'
import { registerDom } from '../testing/dom'
import type { SidebarNavGroup, SidebarNavMode } from './sidebar-nav'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const GROUPS: SidebarNavGroup[] = [
  { id: 'top', items: [{ id: 'discover', label: 'Discover', icon: Compass }] },
  {
    id: 'packages',
    label: 'Packages',
    items: [
      { id: 'apps', label: 'Mini apps', icon: Package, count: 20 },
      { id: 'plugins', label: 'Plugins', icon: Plug, count: 2389 },
      { id: 'pages', label: 'Pages', icon: Package },
    ],
  },
  { id: 'empty', label: 'Capabilities', items: [] },
]

type Timer = { run: () => void; ms: number; live: boolean }

async function mount(mode: SidebarNavMode, active = 'discover') {
  const timers: Timer[] = []
  const peek = {
    schedule: (run: () => void, ms: number) => {
      const timer = { run, ms, live: true }
      timers.push(timer)
      return () => void (timer.live = false)
    },
  }
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SidebarNav } = await import('./sidebar-nav')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const chosen: string[] = []
  const render = (current: string) =>
    root.render(
      <SidebarNav
        label="Store sections"
        mode={mode}
        groups={GROUPS}
        active={current}
        onSelect={(id) => chosen.push(id)}
        search={<input aria-label="Search the Store" />}
        peek={peek}
      />,
    )
  await React.act(async () => render(active))
  const nav = () => host.querySelector('nav')
  const rows = () => [...(nav()?.querySelectorAll('button') ?? [])]
  const press = (key: string) =>
    React.act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    })
  const done = async () => {
    await React.act(async () => root.unmount())
    host.remove()
  }
  return {
    host,
    nav,
    rows,
    press,
    chosen,
    timers,
    /** Lets the newest pending timer fire. */
    fire: () =>
      React.act(async () => {
        const timer = timers.findLast((t) => t.live)
        if (timer) {
          timer.live = false
          timer.run()
        }
      }),
    pointer: (type: string, init: { pointerType?: string; buttons?: number } = {}) =>
      React.act(async () => {
        const target = host.querySelector('[data-sidebar-rail]')!
        // React derives enter/leave from over/out whose relatedTarget is outside.
        const real = type === 'pointerenter' ? 'pointerover' : 'pointerout'
        const event = new Event(real, { bubbles: true })
        Object.assign(event, { pointerType: 'mouse', buttons: 0, ...init })
        target.dispatchEvent(event)
      }),
    focusRow: (index: number) => React.act(async () => rows()[index]!.focus()),
    rerender: (id: string) => React.act(async () => render(id)),
    done,
  }
}

describe('SidebarNav', () => {
  test('groups rows under headings, marks the current one, counts, and keeps the search on top', async () => {
    const view = await mount('full')
    const nav = view.nav()!
    expect(nav.getAttribute('aria-label')).toBe('Store sections')
    expect(nav.textContent).toContain('Packages')
    expect(nav.textContent).not.toContain('Capabilities')
    expect(view.host.querySelector('input[aria-label="Search the Store"]')).not.toBeNull()
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Discover')
    const plugins = view.rows().find((row) => row.textContent?.includes('Plugins'))!
    expect(plugins.textContent).toContain('2,389')
    plugins.click()
    expect(view.chosen).toEqual(['plugins'])
    await view.done()
  })

  test('one tab stop; arrows, Home, End and typed letters move between rows', async () => {
    const view = await mount('full', 'apps')
    const tabbable = view.rows().filter((row) => row.tabIndex === 0)
    expect(tabbable.map((row) => row.textContent)).toEqual(['Mini apps20'])
    tabbable[0]!.focus()
    await view.press('ArrowDown')
    expect(document.activeElement?.textContent).toContain('Plugins')
    await view.press('End')
    expect(document.activeElement?.textContent).toBe('Pages')
    await view.press('Home')
    expect(document.activeElement?.textContent).toBe('Discover')
    await view.press('ArrowUp')
    expect(document.activeElement?.textContent).toBe('Discover')
    await view.press('p')
    expect(document.activeElement?.textContent).toContain('Plugins')
    await view.press('Enter')
    await view.done()
  })

  test('compact is a rail of icons named by label and count; narrow is one select', async () => {
    const compact = await mount('compact')
    expect(compact.nav()!.getAttribute('aria-label')).toBe('Store sections')
    expect(compact.rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Expand Store sections',
      'Discover',
      'Mini apps, 20',
      'Plugins, 2,389',
      'Pages',
    ])
    expect(compact.nav()!.textContent).toBe('')
    expect(compact.host.querySelector('[role="tooltip"]')).toBeNull()
    expect(compact.host.querySelector('input')).toBeNull()
    await compact.done()

    const narrow = await mount('select')
    expect(narrow.nav()).toBeNull()
    const trigger = narrow.host.querySelector('button[aria-label="Store sections"]')
    expect(trigger?.textContent).toContain('Discover')
    expect(narrow.host.querySelector('input[aria-label="Search the Store"]')).not.toBeNull()
    await narrow.done()
  })
})

describe('SidebarNav compact panel', () => {
  const panel = (view: Awaited<ReturnType<typeof mount>>) =>
    view.host.querySelector('[data-state]')!
  const state = (view: Awaited<ReturnType<typeof mount>>) => panel(view).getAttribute('data-state')

  test('opens after a hover dwell and closes after a grace, showing labels, headings and counts', async () => {
    const view = await mount('compact')
    expect(state(view)).toBe('closed')
    await view.pointer('pointerenter')
    expect(state(view)).toBe('closed')
    expect(view.timers.at(-1)!.ms).toBe(120)
    await view.fire()
    expect(state(view)).toBe('open')
    expect(view.nav()!.textContent).toContain('Packages')
    expect(view.nav()!.textContent).toContain('Plugins')
    expect(view.nav()!.textContent).toContain('2,389')
    expect(view.rows()[0]!.getAttribute('aria-expanded')).toBe('true')
    await view.pointer('pointerleave')
    expect(view.timers.at(-1)!.ms).toBe(200)
    expect(state(view)).toBe('open')
    await view.fire()
    expect(state(view)).toBe('closed')
    await view.done()
  })

  test('re-entering within the grace keeps it open; a held button never opens it', async () => {
    const view = await mount('compact')
    await view.pointer('pointerenter', { buttons: 1 })
    expect(view.timers.filter((t) => t.live)).toHaveLength(0)
    await view.pointer('pointerenter')
    await view.fire()
    await view.pointer('pointerleave')
    await view.pointer('pointerenter')
    expect(view.timers.filter((t) => t.live && t.ms === 200)).toHaveLength(0)
    expect(state(view)).toBe('open')
    await view.done()
  })

  test('keyboard focus opens it, Esc closes it, focus leaving closes it', async () => {
    const view = await mount('compact')
    await view.focusRow(1)
    expect(state(view)).toBe('open')
    await view.press('Escape')
    expect(state(view)).toBe('closed')
    expect(document.activeElement).toBe(view.rows()[1]!)
    const outside = document.createElement('button')
    document.body.append(outside)
    await view.focusRow(2)
    expect(state(view)).toBe('open')
    const React = await import('react')
    await React.act(async () => outside.focus())
    expect(state(view)).toBe('closed')
    outside.remove()
    await view.done()
  })

  test('choosing a row selects it and closes the panel', async () => {
    const view = await mount('compact')
    await view.focusRow(1)
    const plugins = view.rows().find((row) => row.textContent?.includes('Plugins'))!
    const React = await import('react')
    await React.act(async () => plugins.click())
    expect(view.chosen).toEqual(['plugins'])
    expect(state(view)).toBe('closed')
    await view.done()
  })

  test('the panel floats: the rail keeps its place in the layout whether open or closed', async () => {
    const view = await mount('compact')
    const rail = view.host.querySelector('[data-sidebar-rail]')!
    const before = rail.className
    expect(panel(view).className).toContain('absolute')
    await view.focusRow(1)
    expect(rail.className).toBe(before)
    expect(panel(view).className).toContain('absolute')
    await view.done()
  })

  test('touch: a tap toggles it, the first tap on a row only opens, a tap outside closes', async () => {
    const view = await mount('compact')
    const React = await import('react')
    const tap = (el: Element) =>
      React.act(async () => {
        const down = new Event('pointerdown', { bubbles: true })
        Object.assign(down, { pointerType: 'touch', buttons: 1 })
        el.dispatchEvent(down)
        ;(el as HTMLElement).click()
      })
    await tap(view.rows()[2]!)
    expect(state(view)).toBe('open')
    expect(view.chosen).toEqual([])
    await tap(view.rows()[2]!.parentElement!)
    expect(state(view)).toBe('closed')
    await tap(view.rows()[0]!)
    expect(state(view)).toBe('open')
    await tap(view.rows()[2]!)
    expect(view.chosen).toEqual(['apps'])
    expect(state(view)).toBe('closed')
    await tap(view.rows()[0]!)
    expect(state(view)).toBe('open')
    await React.act(async () => {
      const down = new Event('pointerdown', { bubbles: true })
      Object.assign(down, { pointerType: 'touch' })
      document.body.dispatchEvent(down)
    })
    expect(state(view)).toBe('closed')
    await view.done()
  })

  test('full mode has no panel state', async () => {
    const view = await mount('full')
    expect(view.host.querySelector('[data-state]')).toBeNull()
    await view.done()
  })
})
