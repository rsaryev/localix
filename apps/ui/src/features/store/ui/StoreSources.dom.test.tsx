import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ADA, HOSTED, listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const LISTINGS = [listing({ id: 'puzzle', displayName: 'Puzzle' })]
const SOURCES = [
  {
    kind: 'mini-app' as const,
    id: HOSTED,
    label: 'Localix',
    url: HOSTED,
    builtIn: true,
    count: 1,
    trust: 'localix' as const,
    syncedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  { kind: 'mini-app' as const, id: ADA, label: 'ada.test', url: ADA, builtIn: false, count: 0 },
  {
    kind: 'plugin' as const,
    id: 'anthropics/claude-plugins-official',
    label: 'claude-plugins-official',
    url: 'https://github.com/anthropics/claude-plugins-official',
    builtIn: false,
    defaultSource: true,
    trust: 'official' as const,
    count: 120,
    autoUpdate: true,
  },
  {
    kind: 'plugin' as const,
    id: 'broken/market',
    label: 'broken/market',
    url: 'https://github.com/broken/market',
    builtIn: false,
    count: 0,
    problem: 'The marketplace answered 404 — dev has not pushed it',
  },
]
const official = (host: HTMLElement) =>
  host.querySelector<HTMLElement>(
    '[data-source="anthropics/claude-plugins-official"] [role="switch"]',
  )!
const dialog = () =>
  document.body.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]')
const field = () =>
  dialog()?.querySelector<HTMLInputElement>('input[aria-label="Source address"]') ?? null

const open = (extra: Parameters<typeof renderStore>[0] extends infer O ? Partial<O> : never = {}) =>
  renderStore({ listings: LISTINGS, sources: SOURCES, target: { shelf: 'sources' }, ...extra })

describe('the Store’s sources', () => {
  test('are grouped by kind, each saying who stands behind it, how many it offers and when it was read', async () => {
    const view = await open()
    try {
      const apps = view.host.querySelector('section[aria-label="Mini app catalogs"]')!
      expect(apps.textContent).toContain('Localix')
      expect(apps.textContent).toContain('1 package')
      expect(apps.textContent).toContain('read 3 hours ago')
      const plugins = view.host.querySelector('section[aria-label="Claude Code marketplaces"]')!
      expect(plugins.textContent).toContain('Official')
      expect(plugins.textContent).toContain('120 packages')
      // Each group is headed, and the page is headed once above them.
      expect(view.host.querySelector('h2')?.textContent).toBe('Sources')
      expect(apps.querySelector('h3')?.textContent).toBe('Mini app catalogs')
    } finally {
      await view.done()
    }
  })

  test('when a source was read keeps counting while the page stays open', async () => {
    jest.useFakeTimers({ now: Date.now() })
    const view = await open()
    try {
      const apps = () => view.host.querySelector('section[aria-label="Mini app catalogs"]')!
      expect(apps().textContent).toContain('read 3 hours ago')
      await view.act(async () => void jest.advanceTimersByTime(3_600_000))
      expect(apps().textContent).toContain('read 4 hours ago')
    } finally {
      await view.done()
      jest.useRealTimers()
    }
  })

  test('a source that could not be read says why, quietly, and is still listed', async () => {
    const view = await open()
    try {
      const row = view.host.querySelector<HTMLElement>('[data-source="broken/market"]')!
      expect(row.textContent).toContain('answered 404')
      expect(row.textContent).toContain('0 packages')
    } finally {
      await view.done()
    }
  })

  test('the menu updates a source now; one that comes with Localix cannot be removed', async () => {
    const view = await open()
    try {
      await view.openMenu(view.button('Localix actions'))
      expect(view.menuItem('Remove…')).toBeUndefined()
      await view.click(view.menuItem('Update now'))
      expect(view.calls).toEqual([`refresh source mini-app ${HOSTED}`])
    } finally {
      await view.done()
    }
  })

  test('the switch is named by text you can see in its row: it is auto-update, not whether the source is on', async () => {
    const view = await open()
    try {
      const toggle = official(view.host)
      const named = toggle
        .getAttribute('aria-labelledby')!
        .split(' ')
        .map((id) => view.host.querySelector<HTMLElement>(`[id="${id}"]`))
      expect(named.every((el) => el?.getAttribute('aria-hidden') === null)).toBe(true)
      const name = named.map((el) => el!.textContent).join(' ')
      expect(name).toContain('Auto-update')
      expect(name).toContain('claude-plugins-official')
    } finally {
      await view.done()
    }
  })

  test('the switch sets a marketplace to update on its own; a catalog has none', async () => {
    const view = await open()
    try {
      expect(view.host.querySelector('[data-source="' + HOSTED + '"] [role="switch"]')).toBeNull()
      const toggle = official(view.host)
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      await view.click(toggle)
      expect(view.calls).toEqual(['auto-update plugin anthropics/claude-plugins-official false'])
    } finally {
      await view.done()
    }
  })

  test('the list follows the server: a switch it announces shows without leaving the page', async () => {
    const view = await open()
    try {
      const toggle = () => official(view.host)
      expect(toggle().getAttribute('aria-checked')).toBe('true')
      await view.changeSources(
        SOURCES.map((source) =>
          source.id === 'anthropics/claude-plugins-official'
            ? { ...source, autoUpdate: false }
            : source,
        ),
      )
      expect(toggle().getAttribute('aria-checked')).toBe('false')
    } finally {
      await view.done()
    }
  })

  test('a switch answers the press at once, keeps the answer until the list agrees, and goes back when the write fails', async () => {
    const view = await open()
    try {
      const toggle = () => official(view.host)
      await view.click(toggle())
      expect(toggle().getAttribute('aria-checked')).toBe('false')
      await view.changeSources(
        SOURCES.map((source) =>
          source.id === 'anthropics/claude-plugins-official'
            ? { ...source, autoUpdate: false }
            : source,
        ),
      )
      expect(toggle().getAttribute('aria-checked')).toBe('false')
    } finally {
      await view.done()
    }
    const refused = await open({ autoUpdateFails: 'The marketplace list is locked' })
    try {
      const toggle = official(refused.host)
      await refused.click(toggle)
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(refused.host.textContent).toContain('The marketplace list is locked')
    } finally {
      await refused.done()
    }
  })

  test('removing asks first; a default source says it will not come back', async () => {
    const view = await open()
    try {
      await view.openMenu(view.button('ada.test actions'))
      await view.click(view.menuItem('Remove…'))
      expect(dialog()?.textContent).toContain('What you installed from it stays')
      await view.click(view.button('Remove', dialog()!))
      expect(view.calls).toEqual([`remove source mini-app ${ADA}`])
      await view.openMenu(view.button('claude-plugins-official actions'))
      await view.click(view.menuItem('Remove…'))
      expect(dialog()?.textContent).toContain('will not come back')
      await view.click(view.button('Cancel', dialog()!))
      expect(view.calls).toHaveLength(1)
    } finally {
      await view.done()
    }
  })

  test('pressing a source opens what it offers', async () => {
    const view = await open()
    try {
      await view.click(view.button('Show what ada.test offers'))
      expect(view.host.querySelector('h2')?.textContent).toBe('ada.test')
      expect(view.reads.at(-1)).toContain(`source=${ADA}`)
    } finally {
      await view.done()
    }
  })

  test('one Add source… button takes any address and reads it with every kind that can add one', async () => {
    const view = await open({ understood: ['mini-app'] })
    try {
      await view.click(view.button('Add source…'))
      expect(dialog()?.querySelector('h2')?.textContent).toBe('Add a source')
      await view.type(field(), 'https://bob.test/mini-app-catalog.json')
      await view.click(view.button('Read', dialog()!))
      expect(view.calls).toEqual([
        'preview mini-app https://bob.test/mini-app-catalog.json',
        'preview plugin https://bob.test/mini-app-catalog.json',
      ])
      expect(dialog()?.textContent).toContain('Mini app catalog')
      expect(dialog()?.textContent).toContain('Ada')
      expect(dialog()?.textContent).toContain('3 packages')
      expect(dialog()?.textContent).toContain('Community')
      expect(view.calls.some((call) => call.startsWith('add'))).toBe(false)
      await view.click(view.button('Add', dialog()!))
      expect(view.calls.at(-1)).toBe('add source mini-app https://bob.test/mini-app-catalog.json')
      expect(dialog()).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('an address both formats match asks which one', async () => {
    const view = await open()
    try {
      await view.click(view.button('Add source…'))
      await view.type(field(), 'bob/both')
      await view.click(view.button('Read', dialog()!))
      expect(dialog()?.textContent).toContain('It is both')
      await view.click(view.button('Claude Code marketplace', dialog()!))
      await view.click(view.button('Add', dialog()!))
      expect(view.calls.at(-1)).toBe('add source plugin bob/both')
    } finally {
      await view.done()
    }
  })

  test('an address that is not a source is refused inside the dialog, the text kept', async () => {
    const view = await open({ previewFails: 'The catalog at broken.test answered 404' })
    try {
      await view.click(view.button('Add source…'))
      await view.type(field(), 'https://broken.test/c.json')
      await view.click(view.button('Read', dialog()!))
      expect(dialog()?.textContent).toContain('answered 404')
      expect(field()?.value).toBe('https://broken.test/c.json')
      expect(view.button('Add', dialog()!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('a link that names a source opens the dialog with its address, read and waiting for a yes', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { addSource: { kind: 'mini-app', input: 'https://bob.test/mini-app-catalog.json' } },
    })
    try {
      expect(field()?.value).toBe('https://bob.test/mini-app-catalog.json')
      expect(view.calls).toEqual(['preview mini-app https://bob.test/mini-app-catalog.json'])
    } finally {
      await view.done()
    }
  })
})
