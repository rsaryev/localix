import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const ref = (id: string, kind: 'mini-app' | 'plugin' = 'mini-app') => ({ kind, id })
const LISTINGS = [
  listing({ id: 'chess', displayName: 'Chess', summary: 'Play a game', category: 'Games' }),
  listing({ id: 'kanban', displayName: 'Kanban', category: 'Productivity' }),
  listing({
    id: 'lint',
    displayName: 'Lint',
    ref: ref('lint', 'plugin'),
    category: 'Development',
    installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
    version: '1.1.0',
  }),
  listing({ id: 'docs', displayName: 'Docs', ref: ref('docs', 'plugin') }),
]
const row = (id: string, title: string, ids: ReturnType<typeof ref>[], extra = {}) => ({
  id,
  title,
  style: 'row' as const,
  items: ids,
  ...extra,
})
const DISCOVER = {
  hero: {
    id: 'hero',
    title: 'Think with the board',
    subtitle: 'A chess partner that never tires',
    style: 'hero' as const,
    items: [ref('chess')],
  },
  rows: [
    row('start', 'Start here', [ref('kanban'), ref('lint', 'plugin')]),
    row('project', 'For this project · TypeScript', [ref('lint', 'plugin')]),
    row('picks', 'Hand-picked', [ref('chess'), ref('docs', 'plugin')], {
      subtitle: 'By the editors',
      source: 'localix',
    }),
    row('kind:mini-app', 'Mini apps', [ref('chess'), ref('kanban')]),
    row('kind:plugin', 'Plugins', [ref('lint', 'plugin'), ref('docs', 'plugin')]),
    row('new', 'New & updated', [ref('docs', 'plugin')]),
  ],
  categories: [
    { id: 'Games', label: 'Games', count: 1 },
    { id: 'Development', label: 'Development', count: 2 },
  ],
}
const section = (host: HTMLElement, title: string) =>
  host.querySelector<HTMLElement>(`section[aria-label="${title}"]`)

describe('Discover', () => {
  test('is the showcase: hero, updates, rows, collections and categories, top to bottom', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      const titles = [...view.host.querySelectorAll('[data-store-scroller] section')].map((s) =>
        s.getAttribute('aria-label'),
      )
      expect(titles).toEqual([
        'Start here',
        'For this project · TypeScript',
        'Collections',
        'Mini apps',
        'Plugins',
        'New & updated',
        'Categories',
      ])
      expect(view.host.querySelector('[aria-roledescription="carousel"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('the hero is the editor’s pick with its own words, and has its Get button', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      const hero = view.host.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!
      const first = hero.querySelector<HTMLElement>('[aria-roledescription="slide"]:not([hidden])')!
      expect(first.textContent).toContain('Think with the board')
      expect(first.textContent).toContain('A chess partner that never tires')
      await view.click(view.button('Get Chess', first))
      expect(view.calls).toEqual(['install mini-app/chess user'])
    } finally {
      await view.done()
    }
  })

  test('the hero pages by arrow, dot and key, and holds up to three slides', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      const hero = view.host.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!
      const shown = () =>
        hero.querySelector('[aria-roledescription="slide"]:not([hidden]) h3')?.textContent
      expect(hero.querySelectorAll('[aria-roledescription="slide"]')).toHaveLength(3)
      await view.click(view.button('Next', hero))
      expect(shown()).toBe('Kanban')
      await view.click(view.button('Show slide 3 of 3'))
      expect(shown()).toBe('Lint')
      await view.press('ArrowRight', hero)
      expect(shown()).toBe('Think with the board')
    } finally {
      await view.done()
    }
  })

  test('with no editor’s hero, Start here leads, so the top is never empty', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: { ...DISCOVER, hero: null, rows: DISCOVER.rows.slice(0, 1) },
    })
    try {
      const hero = view.host.querySelector('[aria-roledescription="carousel"]')!
      expect(hero.textContent).toContain('Kanban')
    } finally {
      await view.done()
    }
  })

  test('the updates strip shows only when there are updates, and Update all takes them', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      expect(view.host.textContent).toContain('1 update available')
      await view.click(view.button('Update all'))
      expect(view.calls).toEqual(['update all'])
      await view.click(view.button('See updates'))
      expect(view.host.querySelector('[aria-current="page"]')?.textContent).toContain('Updates')
    } finally {
      await view.done()
    }
    const none = await renderStore({
      listings: LISTINGS.filter((l) => l.ref.id !== 'lint'),
      discover: { ...DISCOVER, updates: { count: 0 } },
    })
    try {
      expect(none.host.textContent).not.toContain('available')
    } finally {
      await none.done()
    }
  })

  test('For this project is left out when the answer has no such row', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: { ...DISCOVER, rows: DISCOVER.rows.filter((r) => r.id !== 'project') },
    })
    try {
      expect(view.host.textContent).not.toContain('For this project')
    } finally {
      await view.done()
    }
  })

  test('a row’s tiles open their page, and See all opens the full paged list of its kind', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      const mini = section(view.host, 'Mini apps')!
      expect(mini.querySelector('[data-listing="chess"]')!.textContent).toContain('Chess')
      await view.click(view.button('See all Mini apps'))
      expect(view.host.querySelector('h2')?.textContent).toBe('Mini apps')
      expect(view.reads.at(-1)).toContain('shelf=package:mini-app')
      await view.click(view.button('Back'))
      await view.click(view.button('Kanban', section(view.host, 'Mini apps')!))
      expect(view.host.querySelector('[data-store-page="kanban"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a collection is a wide card that opens a page of exactly its packages', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      const collections = section(view.host, 'Collections')!
      expect(collections.textContent).toContain('Hand-picked')
      expect(collections.textContent).toContain('2 packages')
      await view.click(
        view.button('Hand-picked', collections) ?? collections.querySelector('button'),
      )
      expect(view.host.querySelector('h2')?.textContent).toBe('Hand-picked')
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('docs')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a category with its count opens the list of what is in it', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      const categories = section(view.host, 'Categories')!
      expect(categories.textContent).toContain('Development2')
      await view.click(view.button('Games1', categories))
      expect(view.host.querySelector('h2')?.textContent).toBe('Games')
      expect(view.reads.at(-1)).toContain('category=Games')
    } finally {
      await view.done()
    }
  })

  test('narrow, the hero puts its picture on top and rows scroll sideways', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER, width: 600 })
    try {
      const slide = view.host.querySelector('[aria-roledescription="slide"]')!
      expect(slide.className).toContain('grid-cols-1')
      const strip = section(view.host, 'Mini apps')!.querySelector('ul')!
      expect(strip.className).toContain('snap-x')
      expect(strip.className).toContain('overflow-x-auto')
    } finally {
      await view.done()
    }
  })
})
