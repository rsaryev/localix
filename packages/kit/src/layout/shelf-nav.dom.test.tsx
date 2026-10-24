import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('ShelfNav', () => {
  test('groups its shelves under labels, marks the current one and says how many each holds', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ShelfNav } = await import('./shelf-nav')
    const host = document.createElement('div')
    const root = createRoot(host)
    const chosen: string[] = []
    const render = (active: string) =>
      root.render(
        <ShelfNav
          label="Store sections"
          active={active}
          onSelect={(id) => chosen.push(id)}
          groups={[
            { id: 'top', items: [{ id: 'discover', label: 'Discover' }] },
            {
              id: 'packages',
              label: 'Packages',
              items: [{ id: 'apps', label: 'Mini apps', count: 20 }],
            },
            { id: 'empty', label: 'Capabilities', items: [] },
          ]}
        />,
      )
    try {
      await React.act(async () => render('discover'))
      const nav = host.querySelector('nav')!
      expect(nav.getAttribute('aria-label')).toBe('Store sections')
      expect(nav.textContent).toContain('Packages')
      expect(nav.textContent).not.toContain('Capabilities')
      const current = () => nav.querySelector('[aria-current="page"]')?.textContent
      expect(current()).toBe('Discover')
      const apps = [...nav.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Mini apps'),
      )!
      expect(apps.textContent).toContain('20')
      await React.act(async () => apps.click())
      expect(chosen).toEqual(['apps'])
      await React.act(async () => render('apps'))
      expect(current()).toContain('Mini apps')
    } finally {
      await React.act(async () => root.unmount())
    }
  })

  test('compact, it is a column of icons, each named by its label and count', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ShelfNav } = await import('./shelf-nav')
    const { Compass, Package } = await import('lucide-react')
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await React.act(async () =>
        root.render(
          <ShelfNav
            compact
            label="Store sections"
            active="discover"
            onSelect={() => {}}
            groups={[
              { id: 'top', items: [{ id: 'discover', label: 'Discover', icon: Compass }] },
              {
                id: 'library',
                label: 'Library',
                items: [{ id: 'installed', label: 'Installed', icon: Package, count: 3 }],
              },
            ]}
          />,
        ),
      )
      const nav = host.querySelector('nav')!
      expect(nav.textContent).toBe('')
      const names = [...nav.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
      expect(names).toEqual(['Discover', 'Installed, 3'])
      expect(nav.querySelector('[aria-current="page"]')?.getAttribute('aria-label')).toBe(
        'Discover',
      )
    } finally {
      await React.act(async () => root.unmount())
    }
  })
})
