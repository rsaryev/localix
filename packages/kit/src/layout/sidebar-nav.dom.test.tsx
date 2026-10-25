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

async function mount(mode: SidebarNavMode, active = 'discover') {
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

  test('compact, a column of icons named by label and count; narrow, one select', async () => {
    const compact = await mount('compact')
    expect(compact.nav()!.textContent).toBe('')
    expect(compact.rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Discover',
      'Mini apps, 20',
      'Plugins, 2,389',
      'Pages',
    ])
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
