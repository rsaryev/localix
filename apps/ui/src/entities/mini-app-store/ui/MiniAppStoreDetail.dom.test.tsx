import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { renderStore, storeEntry as entry } from '@/testing/miniAppStore'

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
    icon: '/rpc/mini-apps/store/media/chess/icon',
    tags: ['game', 'board-game'],
  }),
  entry({ name: 'kanban', displayName: 'Kanban', category: 'utilities', tags: ['tasks'] }),
]

async function openChess() {
  const view = await renderStore({ entries: ENTRIES })
  await view.click(view.button('Chess', view.row('chess')!))
  const page = () => view.host.querySelector<HTMLElement>('[data-store-page="chess"]')
  const shown = () =>
    page()?.querySelector('[aria-roledescription="slide"]:not([hidden]) img')?.getAttribute('src')
  return { view, page, shown }
}

describe('an app’s page in the store', () => {
  test('opens from its row with its icon, name, publisher, category, tags, version and action', async () => {
    const { view, page } = await openChess()
    try {
      expect(page()).not.toBeNull()
      expect(page()!.querySelector('h1')?.textContent).toBe('Chess')
      expect(page()!.querySelector('img')?.getAttribute('src')).toEndWith('/chess/icon')
      expect(page()!.textContent).toContain('Localix')
      expect(page()!.querySelector('[aria-label="Verified publisher"]')).not.toBeNull()
      expect(page()!.textContent).toContain('Games')
      expect(page()!.textContent).toContain('board-game')
      expect(page()!.textContent).toContain('1.0.0')
      await view.click(view.button('Install', page()!))
      expect(view.calls.install.map(({ name }) => name)).toEqual(['chess'])
    } finally {
      await view.done()
    }
  })

  test('its screenshots page with arrows, the keyboard and dots, each with its caption', async () => {
    const { view, page, shown } = await openChess()
    try {
      expect(shown()).toEndWith('/chess/screenshot/0')
      expect(page()!.textContent).toContain('The board')
      await view.click(view.button('Next screenshot'))
      expect(shown()).toEndWith('/chess/screenshot/1')
      expect(page()!.textContent).toContain('A finished game')
      const carousel = page()!.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!
      await view.press('ArrowLeft', carousel)
      expect(shown()).toEndWith('/chess/screenshot/0')
      await view.click(view.button('Screenshot 2 of 2'))
      expect(shown()).toEndWith('/chess/screenshot/1')
    } finally {
      await view.done()
    }
  })

  test('a screenshot opens full-window at its own resolution, paged with the arrows', async () => {
    const { view } = await openChess()
    try {
      await view.click(view.button('View screenshot 1 full size'))
      const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
      expect(dialog()?.querySelector('img')?.getAttribute('src')).toEndWith('/screenshot/0')
      await view.press('ArrowRight', dialog())
      expect(dialog()?.querySelector('img')?.getAttribute('src')).toEndWith('/screenshot/1')
    } finally {
      await view.done()
    }
  })

  test('About is its README as Markdown, without its raw HTML; Details say what it brings', async () => {
    const { view, page } = await openChess()
    try {
      const about = page()!.querySelector('section[aria-labelledby="store-page-about"]')!
      expect(about.querySelector('strong')?.textContent).toBe('real')
      expect(about.querySelector('b')).toBeNull()
      const details = page()!.querySelector('section[aria-labelledby="store-page-details"]')!
      expect(details.textContent).toContain('178 KB')
      expect(details.textContent).toContain('MIT')
      expect(details.textContent).toContain('Ada')
      expect(details.querySelector('a[href="https://example.test/chess"]')).not.toBeNull()
      expect(details.textContent).toContain('A screen of its own')
      expect(details.textContent).toContain('2 commands')
    } finally {
      await view.done()
    }
  })

  test('Back returns to the list with its filter kept', async () => {
    const view = await renderStore({ entries: ENTRIES })
    try {
      await view.click(view.button('Show apps tagged game'))
      expect(view.row('kanban')).toBeNull()
      await view.click(view.button('Chess', view.row('chess')!))
      await view.click(view.button('Back to the store'))
      expect(view.row('chess')).not.toBeNull()
      expect(view.row('kanban')).toBeNull()
      expect(view.button('Remove the tag filter game')).toBeDefined()
    } finally {
      await view.done()
    }
  })
})
