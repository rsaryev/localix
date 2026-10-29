import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const LISTINGS = [
  listing({
    id: 'planner',
    displayName: 'Planner',
    installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    configurable: true,
  }),
  listing({
    id: 'ledger',
    displayName: 'Ledger',
    version: '2.0.0',
    installs: [{ scope: 'user', version: '1.0.0', enabled: false, updateTo: '2.0.0' }],
  }),
  listing({ id: 'puzzle', displayName: 'Puzzle' }),
  listing({
    id: 'lint',
    displayName: 'Lint',
    ref: { kind: 'plugin', id: 'lint' },
    installs: [{ scope: 'project', version: '0.3.0', enabled: true }],
  }),
]
const row = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-install="${id}"]`)

describe('the Store’s library', () => {
  test('Installed lists every install with its kind, scope, version and switch', async () => {
    const view = await renderStore({ listings: LISTINGS, target: { shelf: 'installed' } })
    try {
      expect(row(view.host, 'puzzle')).toBeNull()
      const planner = row(view.host, 'planner')!
      expect(planner.textContent).toContain('Planner')
      expect(planner.textContent).toContain('Mini app')
      expect(planner.textContent).toContain('For you')
      expect(planner.textContent).toContain('1.0.0')
      const toggle = planner.querySelector<HTMLElement>('[role="switch"]')!
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      await view.click(toggle)
      expect(view.calls).toEqual(['disable mini-app/planner user'])
    } finally {
      await view.done()
    }
  })

  test('kind tabs filter the installs, and a project install says which project', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { shelf: 'installed' },
      project: { id: 'p1', name: 'Atlas' },
    })
    try {
      expect(row(view.host, 'lint')?.textContent).toContain('In Atlas')
      expect(row(view.host, 'lint')?.textContent).toContain('Plugin')
      await view.click(view.button('Plugins', view.host.querySelector('[aria-label="Kinds"]')!))
      expect(row(view.host, 'lint')).not.toBeNull()
      expect(row(view.host, 'planner')).toBeNull()
      await view.click(view.button('All', view.host.querySelector('[aria-label="Kinds"]')!))
      expect(row(view.host, 'planner')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('an install’s menu updates, configures and removes it', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      configs: {
        planner: {
          user: {
            fields: [
              { key: 'board', label: 'Board', type: 'string', required: false, secret: false },
            ],
            values: { board: 'main' },
            set: [],
            scope: 'user',
            scopes: ['user'],
          },
        },
      },
      target: { shelf: 'installed' },
    })
    try {
      await view.openMenu(view.button('Ledger actions'))
      expect(view.menuItem('Configure')).toBeUndefined()
      await view.click(view.menuItem('Update to 2.0.0'))
      await view.openMenu(view.button('Planner actions'))
      expect(view.menuItem('Update to 2.0.0')).toBeUndefined()
      await view.click(view.menuItem('Remove'))
      expect(view.calls).toEqual(['update mini-app/ledger user', 'remove mini-app/planner user'])
      await view.openMenu(view.button('Planner actions'))
      await view.click(view.menuItem('Configure'))
      // Configure opens the package's own page on its Settings tab, not a page of Settings.
      const page = view.host.querySelector('[data-store-page="planner"]')!
      expect(page.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Settings')
    } finally {
      await view.done()
    }
  })

  test('Updates lists what has a newer version, and Update all takes them all', async () => {
    const view = await renderStore({ listings: LISTINGS, target: { shelf: 'updates' } })
    try {
      expect(row(view.host, 'planner')).toBeNull()
      expect(row(view.host, 'ledger')?.textContent).toContain('1.0.0 → 2.0.0')
      await view.click(view.button('Update all'))
      expect(view.calls).toEqual(['update all'])
    } finally {
      await view.done()
    }
  })
})
