import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ADA, HOSTED, listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const installed = (version: string, updateTo?: string) => [
  { scope: 'user' as const, version, enabled: true, ...(updateTo ? { updateTo } : {}) },
]

const LISTINGS = [
  listing({
    id: 'chess',
    displayName: 'Chess',
    category: 'games',
    version: '1.0.0',
    icon: '/rpc/mini-apps/store/media/chess/icon?v=abc',
    tags: ['game', 'board-game', 'chess', 'strategy'],
    featured: true,
    contents: { screen: 1, 'agent-tool': 1, backend: 1, command: 2 },
    components: [
      { kind: 'screen', name: 'Chess', description: 'A screen of its own' },
      { kind: 'command', name: '/chess:play', description: 'Start a game' },
      { kind: 'command', name: '/chess:hint' },
    ],
    runsCode: true,
  }),
  listing({
    id: 'kanban',
    displayName: 'Kanban',
    category: 'utilities',
    installs: installed('1.0.0'),
    tags: ['tasks'],
  }),
  listing({
    id: 'trading',
    displayName: 'Trading',
    category: 'data',
    version: '2.0.0',
    installs: installed('1.0.0', '2.0.0'),
  }),
  listing({
    id: 'weather',
    displayName: 'Weather',
    category: 'utilities',
    job: { action: 'install', phase: 'downloading', received: 25, total: 100 },
  }),
  listing({
    id: 'radio',
    displayName: 'Radio',
    category: 'content',
    publisher: { name: 'Someone', verified: false },
    source: { id: ADA, label: 'ada.test' },
    tags: ['music'],
  }),
  listing({ id: 'future', displayName: 'Future', incompatible: 'Needs a newer Localix' }),
]

const APPS = { shelf: 'package:mini-app' }

describe('the Store’s shelves', () => {
  test('the sections come from what the listings are and contain; an empty one is hidden', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const nav = view.host.querySelector('nav[aria-label="Store sections"]')!
      expect(nav.textContent).toContain('Discover')
      expect(view.shelf('Mini apps')?.textContent).toContain('6')
      expect(view.shelf('Commands')).toBeDefined()
      expect(view.shelf('Updates')?.textContent).toContain('1')
      expect(view.shelf('Sources')).toBeDefined()
      expect(view.shelf('Plugins')).toBeUndefined()
      expect(view.shelf('Skills')).toBeUndefined()
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain('Mini apps')
    } finally {
      await view.done()
    }
  })

  test('Yours is in the library once something the person wrote exists, and lists it', async () => {
    const mine = listing({ id: 'review', displayName: 'Review', authored: 'user' })
    const view = await renderStore({ listings: [...LISTINGS, mine], target: APPS })
    try {
      expect(view.shelf('Yours')?.textContent).toContain('1')
      expect(view.shelf('Project')).toBeUndefined()
      await view.click(view.shelf('Yours'))
      expect(view.card('review')).not.toBeNull()
      expect(view.card('chess')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a shelf lists its packages as rows: name, trust, summary, who and what, and Get', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const chess = view.card('chess')!
      expect(chess.textContent).toContain('Chess')
      expect(chess.querySelector('[aria-label="Verified · Localix"]')).not.toBeNull()
      // Its kind goes without saying on its kind's shelf, and its category does not.
      expect(chess.textContent).not.toContain('Mini app')
      expect(chess.textContent).toContain('games')
      expect(view.button('Get Chess', chess)).toBeDefined()
      expect(view.card('radio')!.textContent).toContain('Community')
      const icon = chess.querySelector('img')!
      expect(icon.getAttribute('src')).toEndWith('/rpc/mini-apps/store/media/chess/icon?v=abc')
      expect(icon.getAttribute('alt')).toBe('')
      await view.act(() => icon.dispatchEvent(new Event('error')))
      expect(view.card('chess')!.querySelector('img')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a listing without an icon is a monogram tile of its name', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const tile = view.card('kanban')!.querySelector('[data-slot="app-tile"]')
      expect(tile?.textContent).toBe('KA')
    } finally {
      await view.done()
    }
  })

  test('Get goes through its states: Get, progress, Update, Installed, and what cannot be got', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      expect(view.button('Update Trading', view.card('trading')!)).toBeDefined()
      expect(view.card('kanban')!.textContent).toContain('Installed')
      const weather = view.card('weather')!
      expect(weather.querySelector('[role="progressbar"]')?.textContent).toContain('25%')
      expect(view.card('future')!.textContent).toContain('Needs a newer Localix')
      expect(view.button('Get Future', view.card('future')!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('Get and Update reach the Store for the person; a verified source needs no sheet', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      await view.click(view.button('Get Chess', view.card('chess')!))
      await view.click(view.button('Update Trading', view.card('trading')!))
      expect(view.calls).toEqual(['install mini-app/chess user', 'update mini-app/trading user'])
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a community source asks first: the sheet names it, and nothing installs until Install', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      await view.click(view.button('Get Radio', view.card('radio')!))
      expect(view.calls).toEqual([])
      const sheet = document.body.querySelector('[role="dialog"]')!
      expect(sheet.textContent).toContain('Install Radio?')
      expect(sheet.textContent).toContain('ada.test')
      expect(sheet.textContent).toContain('Localix does not review what this source lists')
      await view.click(view.button('Cancel', sheet))
      expect(view.calls).toEqual([])
      await view.click(view.button('Get Radio', view.card('radio')!))
      await view.click(view.button('Install', document.body.querySelector('[role="dialog"]')!))
      expect(view.calls).toEqual(['install mini-app/radio user consent'])
    } finally {
      await view.done()
    }
  })

  test('a category narrows the shelf, and the search finds across the Store by name, words or tag', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const tab = (label: string) =>
        [...view.host.querySelectorAll('[role="tab"]')].find((node) =>
          node.textContent?.startsWith(label),
        )
      await view.click(tab('games'))
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
      await view.click(tab('All'))
      const search = view.host.querySelector<HTMLInputElement>(
        'input[aria-label="Search the Store"]',
      )
      await view.type(search, 'trad')
      expect(view.card('trading')).not.toBeNull()
      expect(view.card('chess')).toBeNull()
      await view.type(search, 'music')
      expect(view.card('radio')).not.toBeNull()
      expect(view.card('trading')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('the source filter narrows the shelf to one source, each with its count', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: APPS,
      sources: [
        { kind: 'mini-app', id: HOSTED, label: 'Localix', url: HOSTED, builtIn: true, count: 5 },
        { kind: 'mini-app', id: ADA, label: 'ada.test', url: ADA, builtIn: false, count: 1 },
      ],
    })
    try {
      await view.openMenu(view.button('Source'))
      expect(view.menuItem('Localix')?.textContent).toContain('5')
      expect(view.menuItem('ada.test')?.textContent).toContain('1')
      await view.click(view.menuItem('ada.test'))
      expect(view.card('radio')).not.toBeNull()
      expect(view.card('chess')).toBeNull()
      expect(view.button('Source: ada.test')).toBeDefined()
      await view.click(view.button('Clear source'))
      expect(view.card('chess')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('the next page is read as the list nears its end, and only a window of it is mounted', async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      listing({ id: `app-${i}`, displayName: `App ${i}` }),
    )
    const view = await renderStore({ listings: many, target: APPS })
    try {
      const shown = view.host.querySelectorAll('[data-listing]').length
      expect(shown).toBeGreaterThan(0)
      expect(shown).toBeLessThan(60)
      expect(view.card('app-299')).toBeNull()
      const pane = view.host.querySelector<HTMLElement>('[data-store-scroller]')!
      expect(view.reads.some((read) => read.includes('cursor=80'))).toBe(false)
      await view.act(() => {
        pane.scrollTop = 1500
        pane.dispatchEvent(new Event('scroll'))
      })
      expect(view.reads.some((read) => read.includes('cursor=80'))).toBe(true)
      expect(view.card('app-299')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a source that could not be read is said once, above the listings', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: APPS,
      problems: ['The mini app catalog at example.test answered 503'],
    })
    try {
      expect(view.host.textContent).toContain('answered 503')
    } finally {
      await view.done()
    }
  })

  test('opening the tab at another section moves there', async () => {
    const view = await renderStore({ listings: LISTINGS })
    try {
      await view.retarget({ shelf: 'installed' })
      expect(view.host.querySelector('[aria-current="page"]')?.textContent).toContain('Installed')
    } finally {
      await view.done()
    }
  })

  test('in a narrow pane the sections are one picker beside the search, which moves the Store', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS, width: 600 })
    try {
      expect(view.host.querySelector('nav[aria-label="Store sections"]')).toBeNull()
      const picker = view.host.querySelector<HTMLElement>('[aria-label="Store sections"]')!
      expect(picker.textContent).toContain('Mini apps · 6')
      expect(view.host.querySelector('input[aria-label="Search the Store"]')).not.toBeNull()
      await view.openMenu(picker)
      const installed = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.includes('Installed'),
      )
      await view.click(installed)
      expect(view.host.querySelector('h2')?.textContent).toBe('Installed')
    } finally {
      await view.done()
    }
  })

  test('at a medium width the sidebar is icons named by their labels, in one column of rows', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS, width: 900 })
    try {
      const nav = view.host.querySelector('nav[aria-label="Store sections"]')!
      expect(nav.textContent).toBe('')
      expect(nav.querySelector('[aria-label="Mini apps, 6"][aria-current="page"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })
})
