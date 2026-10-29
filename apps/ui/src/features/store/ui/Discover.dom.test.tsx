import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { registerCompletionWorkingSet } from '@/shared/api/completionWorkingSet'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const ref = (id: string, kind: 'mini-app' | 'plugin' = 'mini-app') => ({ kind, id })
const LISTINGS = [
  listing({ id: 'puzzle', displayName: 'Puzzle', summary: 'Play a game', category: 'Games' }),
  listing({ id: 'planner', displayName: 'Planner', category: 'Productivity' }),
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
  rows: [
    row('start', 'Start here', [ref('planner'), ref('lint', 'plugin')]),
    row('project', 'For this project · TypeScript', [ref('lint', 'plugin')]),
    row('picks', 'Hand-picked', [ref('puzzle'), ref('docs', 'plugin')], {
      subtitle: 'By the editors',
      source: 'localix',
    }),
    row('kind:mini-app', 'Mini apps', [ref('puzzle'), ref('planner')]),
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
  test('is the showcase: updates, rows, collections and categories, top to bottom', async () => {
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
    } finally {
      await view.done()
    }
  })

  test('opens on the next section, with no carousel above it', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
    try {
      expect(!!view.host.querySelector('[aria-roledescription="carousel"]')).toBe(false)
      const first = view.host.querySelector('[data-store-scroller] > div > :first-child')!
      expect(first.textContent).toContain('1 update available')
      expect(first.nextElementSibling?.getAttribute('aria-label')).toBe('Start here')
    } finally {
      await view.done()
    }
  })

  test('with no updates, Start here is the first thing Discover shows', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: { ...DISCOVER, updates: { count: 0 } },
    })
    try {
      const first = view.host.querySelector('[data-store-scroller] > div > :first-child')!
      expect(first.getAttribute('aria-label')).toBe('Start here')
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
      expect(view.activeSection()).toContain('Updates')
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
      expect(mini.querySelector('[data-listing="puzzle"]')!.textContent).toContain('Puzzle')
      await view.click(view.button('See all Mini apps'))
      expect(view.host.querySelector('h2')?.textContent).toBe('Mini apps')
      expect(view.reads.at(-1)).toContain('shelf=package:mini-app')
      await view.click(view.button(/^Back to /))
      await view.click(view.button('Planner', section(view.host, 'Mini apps')!))
      expect(view.host.querySelector('[data-store-page="planner"]')).not.toBeNull()
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
      expect(view.card('puzzle')).not.toBeNull()
      expect(view.card('docs')).not.toBeNull()
      expect(view.card('planner')).toBeNull()
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

  test('a row is whole tiles in as many columns as the pane fits, at most two rows of them', async () => {
    const all = [ref('puzzle'), ref('planner'), ref('lint', 'plugin'), ref('docs', 'plugin')]
    const discover = { ...DISCOVER, rows: [row('start', 'Start here', all)] }
    const tiles = (host: HTMLElement) => {
      const grid = section(host, 'Start here')!.querySelector<HTMLElement>('ul')!
      return { columns: grid.style.gridTemplateColumns, shown: grid.querySelectorAll('li').length }
    }
    const narrow = await renderStore({ listings: LISTINGS, discover, width: 400 })
    try {
      expect(tiles(narrow.host)).toEqual({ columns: 'repeat(1, minmax(0, 1fr))', shown: 2 })
      expect(narrow.host.querySelector('[aria-label^="Scroll Start here"]')).toBeNull()
    } finally {
      await narrow.done()
    }
    const wide = await renderStore({ listings: LISTINGS, discover, width: 1400 })
    try {
      expect(tiles(wide.host)).toEqual({ columns: 'repeat(4, minmax(0, 1fr))', shown: 4 })
    } finally {
      await wide.done()
    }
  })

  test('For your work shows what suits the tabs open beside it, asked with them', async () => {
    const stop = registerCompletionWorkingSet(() => [
      { kind: 'file', token: '@file:Dockerfile', label: 'Dockerfile' },
    ])
    const asked: string[] = []
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs'],
      recommendAsked: asked,
      sessionId: 's1',
    })
    try {
      const titles = [...view.host.querySelectorAll('[data-store-scroller] section')].map((s) =>
        s.getAttribute('aria-label'),
      )
      expect(titles.slice(0, 2)).toEqual(['Start here', 'For your work'])
      const mine = section(view.host, 'For your work')!
      expect(mine.querySelector('[data-listing="docs"]')!.textContent).toContain('Docs')
      expect(asked).toEqual(['Dockerfile in s1'])
    } finally {
      stop()
      await view.done()
    }
  })

  test('For your work is left out when nothing suits it', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER, recommended: [] })
    try {
      expect(section(view.host, 'For your work')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('For your work appears once the background has worked it out, on its poke', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs'],
      recommendPending: true,
    })
    try {
      expect(section(view.host, 'For your work')).toBeNull()
      await view.recommendationsReady()
      expect(section(view.host, 'For your work')!.textContent).toContain('Docs')
    } finally {
      await view.done()
    }
  })

  test('See all on For your work opens every recommendation, best first', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs', 'puzzle'],
    })
    try {
      await view.click(view.button('See all For your work'))
      expect(view.host.querySelector('h2')?.textContent).toBe('For your work')
      const order = [...view.host.querySelectorAll('[data-listing]')].map((card) =>
        card.getAttribute('data-listing'),
      )
      expect(order).toEqual(['docs', 'puzzle'])
    } finally {
      await view.done()
    }
  })

  test('For your work holds what suits the work; the trusted picks that fill the list stay in See all', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs', 'puzzle'],
      recommendMatched: 1,
    })
    try {
      const mine = section(view.host, 'For your work')!
      expect(mine.querySelector('[data-listing="docs"]')).not.toBeNull()
      expect(mine.querySelector('[data-listing="puzzle"]')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('every recommendation in See all says why it is there', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs', 'puzzle', 'planner'],
      recommendMatched: 2,
      recommendReasons: {
        'plugin:docs': { source: 'open', label: 'Dockerfile' },
        'mini-app:puzzle': { source: 'installed', label: 'Chess and Go' },
        'mini-app:planner': { source: 'trusted' },
      },
      target: { recommended: true },
    })
    try {
      expect(view.card('docs')!.textContent).toContain('Because Dockerfile is open')
      expect(view.card('puzzle')!.textContent).toContain('Because you use Chess and Go')
      expect(view.card('planner')!.textContent).toContain('A trusted pick')
    } finally {
      await view.done()
    }
  })

  test('Not interested takes a recommendation away, and it does not come back', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs', 'puzzle'],
      target: { recommended: true },
    })
    try {
      await view.click(view.button('Not interested in Docs'))
      expect(view.calls).toEqual(['not interested plugin/docs'])
      await view.recommendationsReady()
      const recommended = section(view.host, 'Recommended packages')!
      expect(recommended.querySelector('[data-listing="docs"]')).toBeNull()
      expect(recommended.querySelector('[data-listing="puzzle"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('what was turned down is listed under the recommendations, and can be recommended again', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs', 'puzzle'],
      dismissed: [{ id: 'planner', reason: 'removed' }],
      target: { recommended: true },
    })
    try {
      await view.click(view.button('Not interested in Docs'))
      await view.recommendationsReady()
      const turned = section(view.host, 'Not recommended')!
      expect(turned.querySelector('[data-listing="docs"]')!.textContent).toContain(
        'You were not interested',
      )
      expect(turned.querySelector('[data-listing="planner"]')!.textContent).toContain(
        'You removed it',
      )
      await view.click(view.button('Recommend Docs again'))
      expect(view.calls).toEqual(['not interested plugin/docs', 'interested again plugin/docs'])
    } finally {
      await view.done()
    }
  })

  test('See all tells the Store what it showed, each with its place and what found it, once', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs', 'puzzle'],
      recommendMatched: 1,
      recommendReasons: {
        'plugin:docs': { source: 'open', label: 'Dockerfile' },
        'mini-app:puzzle': { source: 'trusted' },
      },
      recommendEvents: [],
      target: { recommended: true },
    })
    try {
      await view.recommendationsReady()
      await view.click(view.button('Docs', view.card('docs')!))
      expect(view.recommendEvents()).toEqual([
        'shown plugin/docs@0 open',
        'shown mini-app/puzzle@1 trusted',
        'opened plugin/docs@0 open',
      ])
    } finally {
      await view.done()
    }
  })

  test('For your work on Discover tells the Store what it showed and what was opened', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['docs'],
      recommendReasons: { 'plugin:docs': { source: 'linked', label: 'Dockerfile' } },
      recommendEvents: [],
    })
    try {
      const mine = section(view.host, 'For your work')!
      await view.click(view.button('Docs', mine))
      expect(view.recommendEvents()).toEqual([
        'shown plugin/docs@0 linked',
        'opened plugin/docs@0 linked',
      ])
    } finally {
      await view.done()
    }
  })

  test('opened at its recommendations, the Store shows them', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      discover: DISCOVER,
      recommended: ['puzzle'],
      target: { recommended: true },
    })
    try {
      expect(view.host.querySelector('h2')?.textContent).toBe('For your work')
      expect(view.card('puzzle')).not.toBeNull()
    } finally {
      await view.done()
    }
  })
})
