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
const sectionOf = (card: HTMLElement | null) =>
  card?.closest('section')?.querySelector('h2')?.textContent ?? null

describe('the Store’s shelves', () => {
  test('the shelves come from what the listings are and contain; an empty one is hidden', async () => {
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
      await view.click(view.shelf('Commands'))
      expect(view.host.querySelector('[data-component="command:/chess:play"]')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('apps are grouped by what they need, with the featured ones on top', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      expect(
        view.host.querySelector('section[aria-label="Featured"] [data-listing="chess"]'),
      ).not.toBeNull()
      expect(
        sectionOf(
          view.host.querySelector('section:not([aria-label="Featured"]) [data-listing="trading"]'),
        ),
      ).toContain('Updates')
      expect(sectionOf(view.card('kanban'))).toContain('Installed')
      expect(view.card('trading')?.textContent).toContain('1.0.0 → 2.0.0')
      expect(view.card('weather')?.querySelector('[role="progressbar"]')).not.toBeNull()
      expect(view.card('weather')?.textContent).toContain('25%')
      expect(view.card('future')?.textContent).toContain('Needs a newer Localix')
      expect(view.button('Install Future', view.card('future')!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('a featured listing shows once: in Featured, not again under Available', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      expect(view.host.querySelectorAll('[data-listing="chess"]')).toHaveLength(1)
      expect(sectionOf(view.card('chess'))).toContain('Featured')
      expect(sectionOf(view.card('radio'))).toContain('Available')
    } finally {
      await view.done()
    }
  })

  test('a card is its icon, name, mark, summary and tags; what is inside only when it tells it apart', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const chess = view.card('chess')!
      // The title row is the name and the verified mark, nothing that could crowd them.
      expect(chess.querySelector('p')?.textContent).toBe('Chess')
      expect(chess.querySelector('[aria-label="Verified publisher"]')).not.toBeNull()
      // A screen and agent tools go without saying for a mini app; what runs is on its page.
      for (const noise of ['Screen', 'Agent tools', 'Runs code']) {
        expect(chess.textContent).not.toContain(noise)
      }
      // Commands tell Chess apart: no other mini app here has any.
      expect(chess.textContent).toContain('2 commands')
      // Its kind goes without saying on its kind's shelf, and is said everywhere else.
      expect(chess.textContent).not.toContain('Mini app')
      await view.click(view.shelf('Discover'))
      expect(view.card('chess')!.textContent).toContain('Mini app · 2 commands')
      await view.click(view.shelf('Mini apps'))
      const icon = view.card('chess')!.querySelector('img')!
      expect(icon.getAttribute('src')).toEndWith('/rpc/mini-apps/store/media/chess/icon?v=abc')
      expect(icon.getAttribute('alt')).toBe('')
      expect(view.card('kanban')!.querySelector('[data-slot="monogram-avatar"]')).not.toBeNull()
      await view.act(() => icon.dispatchEvent(new Event('error')))
      expect(view.card('chess')!.querySelector('img')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('what every listing of a kind has is not said on any of them', async () => {
    const both = [
      listing({ id: 'chess', displayName: 'Chess', contents: { screen: 1, command: 2 } }),
      listing({ id: 'go', displayName: 'Go', contents: { screen: 1, command: 1 } }),
    ]
    const view = await renderStore({ listings: both, target: APPS })
    try {
      expect(view.card('chess')!.textContent).not.toContain('command')
      expect(view.card('go')!.textContent).not.toContain('command')
    } finally {
      await view.done()
    }
  })

  test('install, update and remove each reach the Store for the person', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      await view.click(view.button('Install Chess', view.card('chess')!))
      await view.click(view.button('Update', view.card('trading')!))
      await view.click(view.button('Remove Kanban', view.card('kanban')!))
      expect(view.calls).toEqual([
        'install mini-app/chess user',
        'update mini-app/trading user',
        'remove mini-app/kanban user',
      ])
    } finally {
      await view.done()
    }
  })

  test('an unverified publisher is named, and installing asks for a yes in the card', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      expect(view.card('radio')?.textContent).toContain('Unverified · Someone')
      expect(view.card('chess')?.querySelector('[aria-label="Verified publisher"]')).not.toBeNull()
      await view.click(view.button('Install Radio', view.card('radio')!))
      expect(view.calls).toEqual([])
      expect(view.card('radio')?.textContent).toContain('Install anyway?')
      await view.click(view.button('Install anyway', view.card('radio')!))
      expect(view.calls).toEqual(['install mini-app/radio user consent'])
    } finally {
      await view.done()
    }
  })

  test('a card shows at most three tags; one filters the shelf until it is removed', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const tags = [...view.card('chess')!.querySelectorAll('[data-tag]')].map((t) => t.textContent)
      expect(tags).toEqual(['game', 'board-game', 'chess'])
      await view.click(view.button('Show packages tagged board-game'))
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
      await view.click(view.button('Remove the tag filter board-game'))
      expect(view.card('kanban')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a category narrows the shelf; the search finds across the Store by name, words or tag', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const tab = (label: string) =>
        [...view.host.querySelectorAll('[role="tab"]')].find((node) => node.textContent === label)
      await view.click(tab('Games'))
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

  test('the source menu narrows the shelf to one source, each with its count', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: APPS,
      sources: [
        { kind: 'mini-app', id: HOSTED, label: 'Localix', url: HOSTED, builtIn: true, count: 5 },
        { kind: 'mini-app', id: ADA, label: 'ada.test', url: ADA, builtIn: false, count: 1 },
      ],
    })
    try {
      await view.openMenu(view.button('Sources: All sources'))
      expect(view.menuItem('Localix')?.textContent).toContain('5')
      expect(view.menuItem('ada.test')?.textContent).toContain('1')
      await view.click(view.menuItem('ada.test'))
      expect(view.card('radio')).not.toBeNull()
      expect(view.card('chess')).toBeNull()
      expect(view.button('Sources: ada.test')).toBeDefined()
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

  test('Discover holds what is featured; opening the tab at a shelf moves there', async () => {
    const view = await renderStore({ listings: LISTINGS })
    try {
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
      await view.retarget({ shelf: 'installed' })
      expect(view.host.querySelector('[aria-current="page"]')?.textContent).toContain('Installed')
    } finally {
      await view.done()
    }
  })

  test('in a narrow pane the sections are one picker, which moves the Store like the column', async () => {
    const view = await renderStore({ listings: LISTINGS, target: APPS })
    try {
      const picker = view.host.querySelector<HTMLElement>('[aria-label="Store section"]')!
      expect(picker.textContent).toContain('Mini apps · 6')
      await view.openMenu(picker)
      const installed = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.includes('Installed'),
      )
      await view.click(installed)
      const nav = view.host.querySelector('nav[aria-label="Store sections"]')!
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain('Installed')
    } finally {
      await view.done()
    }
  })
})
