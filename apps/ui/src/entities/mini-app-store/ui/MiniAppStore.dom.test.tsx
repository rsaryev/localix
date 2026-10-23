import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ADA, HOSTED, renderStore, storeEntry as entry } from '@/testing/miniAppStore'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const ENTRIES = [
  entry({
    name: 'chess',
    displayName: 'Chess',
    category: 'games',
    version: '1.0.0',
    icon: '/rpc/mini-apps/store/media/chess/icon?v=abc',
    tags: ['game', 'board-game', 'chess', 'strategy'],
    featured: true,
  }),
  entry({
    name: 'kanban',
    displayName: 'Kanban',
    category: 'utilities',
    installed: { version: '1.0.0' },
    tags: ['tasks'],
  }),
  entry({
    name: 'trading',
    displayName: 'Trading',
    category: 'data',
    version: '2.0.0',
    installed: { version: '1.0.0' },
    update: true,
  }),
  entry({
    name: 'weather',
    displayName: 'Weather',
    category: 'utilities',
    job: { phase: 'downloading', received: 25, total: 100 },
  }),
  entry({
    name: 'radio',
    displayName: 'Radio',
    category: 'content',
    publisher: { name: 'Someone', verified: false },
    source: ADA,
    tags: ['music'],
  }),
  entry({ name: 'future', displayName: 'Future', incompatible: true }),
]

const sectionOf = (row: HTMLElement | null) =>
  row?.closest('section')?.querySelector('h2')?.textContent ?? null

describe('the mini app store list', () => {
  test('apps are grouped by what they need, with the featured ones on top', async () => {
    const view = await renderStore({ entries: ENTRIES })
    try {
      const featured = view.host.querySelector('section[aria-label="Featured"]')
      expect(featured?.querySelector('[data-mini-app="chess"]')).not.toBeNull()
      expect(
        sectionOf(
          view.host.querySelector('section:not([aria-label="Featured"]) [data-mini-app="trading"]'),
        ),
      ).toContain('Updates')
      expect(sectionOf(view.row('kanban'))).toContain('Installed')
      expect(view.row('trading')?.textContent).toContain('1.0.0 → 2.0.0')
      expect(view.row('weather')?.querySelector('[role="progressbar"]')).not.toBeNull()
      expect(view.row('weather')?.textContent).toContain('25%')
      expect(view.row('future')?.textContent).toContain('Needs a newer Localix')
      expect(view.button('Install', view.row('future')!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('a row shows the app’s own icon, and a monogram only when the icon does not load', async () => {
    const view = await renderStore({ entries: ENTRIES })
    try {
      const icon = view.row('chess')!.querySelector('img')!
      expect(icon.getAttribute('src')).toEndWith('/rpc/mini-apps/store/media/chess/icon?v=abc')
      expect(icon.getAttribute('alt')).toBe('')
      expect(view.row('kanban')!.querySelector('[data-slot="monogram-avatar"]')).not.toBeNull()
      await view.act(() => icon.dispatchEvent(new Event('error')))
      expect(view.row('chess')!.querySelector('img')).toBeNull()
      expect(view.row('chess')!.querySelector('[data-slot="monogram-avatar"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('install, update and remove each call their action', async () => {
    const view = await renderStore({ entries: ENTRIES })
    try {
      await view.click(view.button('Install', view.row('chess')!))
      await view.click(view.button('Update', view.row('trading')!))
      await view.click(view.button('Remove Kanban', view.row('kanban')!))
      expect(view.calls.install.map(({ name }) => name)).toEqual(['chess', 'trading'])
      expect(view.calls.remove).toEqual(['kanban'])
    } finally {
      await view.done()
    }
  })

  test('an unverified publisher is named, and installing asks for a yes in the row', async () => {
    const view = await renderStore({ entries: ENTRIES })
    try {
      expect(view.row('radio')?.textContent).toContain('Unverified · Someone')
      expect(view.row('chess')?.querySelector('[aria-label="Verified publisher"]')).not.toBeNull()
      await view.click(view.button('Install', view.row('radio')!))
      expect(view.calls.install).toEqual([])
      expect(view.row('radio')?.textContent).toContain('Install anyway?')
      await view.click(view.button('Install anyway', view.row('radio')!))
      expect(view.calls.install).toEqual([{ name: 'radio', acceptUnverified: true }])
    } finally {
      await view.done()
    }
  })

  test('a row shows at most three tags, and choosing one filters the list until it is removed', async () => {
    const view = await renderStore({ entries: ENTRIES })
    try {
      const tags = [...view.row('chess')!.querySelectorAll('[data-tag]')].map(
        (tag) => tag.textContent,
      )
      expect(tags).toEqual(['game', 'board-game', 'chess'])
      await view.click(view.button('Show apps tagged board-game'))
      expect(view.row('chess')).not.toBeNull()
      expect(view.row('kanban')).toBeNull()
      await view.click(view.button('Remove the tag filter board-game'))
      expect(view.row('kanban')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a category narrows the rows, and the search finds by name, words or tag', async () => {
    const view = await renderStore({ entries: ENTRIES })
    try {
      const tab = (label: string) =>
        [...view.host.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label)
      await view.click(tab('Games'))
      expect(view.row('chess')).not.toBeNull()
      expect(view.row('kanban')).toBeNull()
      await view.click(tab('All'))
      const search = view.host.querySelector<HTMLInputElement>(
        'input[aria-label="Search mini apps"]',
      )
      await view.type(search, 'trad')
      expect(view.row('trading')).not.toBeNull()
      expect(view.row('chess')).toBeNull()
      await view.type(search, 'music')
      expect(view.row('radio')).not.toBeNull()
      expect(view.row('trading')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('the catalog menu narrows the store to one catalog, each with its app count', async () => {
    const view = await renderStore({
      entries: ENTRIES,
      catalogs: [
        { url: HOSTED, builtIn: true },
        { url: ADA, builtIn: false },
      ],
    })
    try {
      await view.openMenu(view.button('Catalogs: All catalogs'))
      const localix = view.menuItem('Localix')
      expect(localix?.textContent).toContain('5')
      expect(view.menuItem('ada.test')?.textContent).toContain('1')
      await view.click(view.menuItem('ada.test'))
      expect(view.row('radio')).not.toBeNull()
      expect(view.row('chess')).toBeNull()
      expect(view.button('Catalogs: ada.test')).toBeDefined()
    } finally {
      await view.done()
    }
  })

  test('a catalog that could not be read is said once, above the apps', async () => {
    const view = await renderStore({
      entries: ENTRIES,
      problems: ['The mini app catalog at example.test answered 503'],
    })
    try {
      expect(view.host.textContent).toContain('answered 503')
    } finally {
      await view.done()
    }
  })
})
