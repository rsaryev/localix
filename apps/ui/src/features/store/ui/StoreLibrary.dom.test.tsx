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
    id: 'kanban',
    displayName: 'Kanban',
    installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    configure: 'localix://ui/settings/mini-apps#mini-app:sample-board',
  }),
  listing({
    id: 'trading',
    displayName: 'Trading',
    version: '2.0.0',
    installs: [{ scope: 'user', version: '1.0.0', enabled: false, updateTo: '2.0.0' }],
  }),
  listing({ id: 'chess', displayName: 'Chess' }),
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
      expect(row(view.host, 'chess')).toBeNull()
      const kanban = row(view.host, 'kanban')!
      expect(kanban.textContent).toContain('Kanban')
      expect(kanban.textContent).toContain('Mini app')
      expect(kanban.textContent).toContain('For you')
      expect(kanban.textContent).toContain('1.0.0')
      const toggle = kanban.querySelector<HTMLElement>('[role="switch"]')!
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      await view.click(toggle)
      expect(view.calls).toEqual(['disable mini-app/kanban user'])
    } finally {
      await view.done()
    }
  })

  test('chips filter the installs by kind, and a project install says which project', async () => {
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
      expect(row(view.host, 'kanban')).toBeNull()
      await view.click(view.button('Everything'))
      expect(row(view.host, 'kanban')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('an install’s menu updates, configures and removes it', async () => {
    const view = await renderStore({ listings: LISTINGS, target: { shelf: 'installed' } })
    try {
      await view.openMenu(view.button('Trading actions'))
      expect(view.menuItem('Configure')).toBeUndefined()
      await view.click(view.menuItem('Update to 2.0.0'))
      await view.openMenu(view.button('Kanban actions'))
      expect(view.menuItem('Update to 2.0.0')).toBeUndefined()
      await view.click(view.menuItem('Remove'))
      expect(view.calls).toEqual(['update mini-app/trading user', 'remove mini-app/kanban user'])
      await view.openMenu(view.button('Kanban actions'))
      await view.click(view.menuItem('Configure'))
      expect(view.calls.at(-1)).toBe(
        'navigate localix://ui/settings/mini-apps#mini-app:sample-board',
      )
    } finally {
      await view.done()
    }
  })

  test('Updates lists what has a newer version, and Update all takes them all', async () => {
    const view = await renderStore({ listings: LISTINGS, target: { shelf: 'updates' } })
    try {
      expect(row(view.host, 'kanban')).toBeNull()
      expect(row(view.host, 'trading')?.textContent).toContain('1.0.0 → 2.0.0')
      await view.click(view.button('Update all'))
      expect(view.calls).toEqual(['update all'])
    } finally {
      await view.done()
    }
  })
})
