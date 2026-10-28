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
    id: 'chess',
    displayName: 'Chess',
    category: 'games',
    version: '1.0.0',
    icon: '/rpc/mini-apps/store/media/chess/icon',
    tags: ['game', 'board-game'],
    contents: { screen: 1, command: 1 },
  }),
  listing({ id: 'kanban', displayName: 'Kanban', category: 'utilities', tags: ['tasks'] }),
  listing({
    id: 'radio',
    displayName: 'Radio',
    publisher: { name: 'Someone', verified: false },
    tags: ['music'],
  }),
]

async function open(id = 'chess', name = 'Chess') {
  const view = await renderStore({ listings: LISTINGS, target: { shelf: 'package:mini-app' } })
  await view.click(view.button(name, view.card(id)!))
  const page = () => view.host.querySelector<HTMLElement>(`[data-store-page="${id}"]`)
  const shown = () =>
    page()?.querySelector('[aria-roledescription="slide"]:not([hidden]) img')?.getAttribute('src')
  const tab = (label: string) =>
    [...(page()?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(
      (node) => node.textContent === label,
    )
  return { view, page, shown, tab }
}

describe('a package’s page', () => {
  test('opens from its row: icon, name, publisher and trust, kind, category, tags and Get', async () => {
    const { view, page } = await open()
    try {
      expect(page()!.querySelector('h1')?.textContent).toBe('Chess')
      expect(page()!.querySelector('img')?.getAttribute('src')).toEndWith('/chess/icon')
      expect(page()!.textContent).toContain('Localix')
      expect(page()!.querySelector('[aria-label="Verified · Localix"]')).not.toBeNull()
      expect(page()!.textContent).toContain('games')
      expect(view.button('Show packages tagged board-game', page()!)).toBeDefined()
      await view.click(view.button('Get Chess', page()!))
      expect(view.calls).toEqual(['install mini-app/chess user'])
    } finally {
      await view.done()
    }
  })

  test('the facts say kind, version, source, license and whether it runs code', async () => {
    const { view, page } = await open()
    try {
      const facts = page()!.querySelector('[aria-label="Information"]')!
      for (const text of ['Mini app', '1.0.0', 'Localix', 'MIT', 'Runs code']) {
        expect(facts.textContent).toContain(text)
      }
      expect(facts.querySelector('a[href="https://example.test/chess"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('its screenshots page, and one opens full-window, paged with the arrows', async () => {
    const { view, page, shown } = await open()
    try {
      expect(shown()).toEndWith('/chess/screenshot/0')
      expect(page()!.textContent).toContain('The board')
      await view.click(view.button('Next screenshot'))
      expect(shown()).toEndWith('/chess/screenshot/1')
      await view.click(view.button('View screenshot 1 full size'))
      const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
      expect(dialog()?.querySelector('img')?.getAttribute('src')).toEndWith('/screenshot/0')
      await view.press('ArrowRight', dialog())
      expect(dialog()?.querySelector('img')?.getAttribute('src')).toEndWith('/screenshot/1')
    } finally {
      await view.done()
    }
  })

  test('the description is the README as the chat renders markdown, without raw HTML', async () => {
    const { view, page } = await open()
    try {
      const about = page()!.querySelector('section[aria-label="Description"]')!
      expect(about.querySelector('strong')?.textContent).toBe('real')
      expect(about.querySelector('b')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('What’s inside lists its parts; Permissions is the plan', async () => {
    const { view, page, tab } = await open()
    try {
      const panel = () => page()!.querySelector('[role="tabpanel"]')!
      expect(panel().textContent).toContain('A screen of its own')
      expect(panel().textContent).toContain('/chess:play')
      await view.click(tab('Permissions'))
      expect(panel().textContent).toContain('Runs on this computer')
      const headings = [...panel().querySelectorAll('h3')].map((node) => node.textContent)
      expect(headings).toContain('Runs on this computer')
      expect(panel().textContent).toContain('node check.js')
      expect(panel().textContent).toContain('api.example.test')
      await view.click(tab('Versions'))
      expect(panel().textContent).toContain('Offered')
    } finally {
      await view.done()
    }
  })

  test('a community package asks first, and its sheet carries the plan’s warning', async () => {
    const { view, page } = await open('radio', 'Radio')
    try {
      await view.click(view.button('Get Radio', page()!))
      expect(view.calls).toEqual([])
      const sheet = document.body.querySelector<HTMLElement>('[role="dialog"]')!
      expect(sheet.textContent).toContain('Localix does not review what this source lists')
      expect(sheet.textContent).toContain('node check.js')
      await view.click(view.button('Install', sheet))
      expect(view.calls).toEqual(['install mini-app/radio user consent'])
    } finally {
      await view.done()
    }
  })

  test('a plugin can be got for the open project alone, from the chevron beside Get', async () => {
    const view = await renderStore({
      listings: [listing({ id: 'lint', displayName: 'Lint', ref: { kind: 'plugin', id: 'lint' } })],
      project: { id: 'p1', name: 'Atlas' },
      target: { shelf: 'package:plugin' },
    })
    try {
      await view.click(view.button('Lint', view.card('lint')!))
      const page = view.host.querySelector<HTMLElement>('[data-store-page="lint"]')!
      await view.openMenu(view.button('Where to get Lint', page))
      expect(view.menuItem('Get for you')).toBeDefined()
      await view.click(view.menuItem('Get for Atlas'))
      expect(view.calls).toEqual(['install plugin/lint project in p1'])
    } finally {
      await view.done()
    }
  })

  test('Back is named by the place it returns to, in the words it shows', async () => {
    const view = await renderStore({ listings: LISTINGS, target: { shelf: 'package:mini-app' } })
    try {
      await view.click(view.button('Chess', view.card('chess')!))
      const back = view.host.querySelector<HTMLButtonElement>('[data-store-back]')!
      expect(back.getAttribute('aria-label')).toBe(`Back to ${back.textContent}`)
    } finally {
      await view.done()
    }
  })

  test('Back returns to the shelf with its category kept', async () => {
    const view = await renderStore({ listings: LISTINGS, target: { shelf: 'package:mini-app' } })
    try {
      const tab = (label: string) =>
        [...view.host.querySelectorAll('[role="tab"]')].find((node) =>
          node.textContent?.startsWith(label),
        )
      await view.click(tab('games'))
      expect(view.card('kanban')).toBeNull()
      await view.click(view.button('Chess', view.card('chess')!))
      expect(view.host.querySelector('[data-store-page="chess"]')).not.toBeNull()
      await view.click(view.button(/^Back to /))
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a tag opens a list of what carries it, and Back returns to the page', async () => {
    const { view, page } = await open()
    try {
      await view.click(view.button('Show packages tagged game', page()!))
      expect(view.host.querySelector('h2')?.textContent).toBe('Tagged “game”')
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
      await view.click(view.button(/^Back to /))
      expect(page()).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('narrow, Get stays in the header and the facts go under the header', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { ref: { kind: 'mini-app', id: 'chess' } },
      width: 600,
    })
    try {
      const page = view.host.querySelector('[data-store-page="chess"]')!
      const header = page.querySelector('header')!
      expect(view.button('Get Chess', header)).toBeDefined()
      // One Get on the page, where the eye already is: no second bar pinned to the bottom.
      expect(page.querySelectorAll('button[aria-label="Get Chess"]')).toHaveLength(1)
      expect(page.querySelectorAll('[aria-label="Information"]')).toHaveLength(1)
      expect(page.querySelector('aside')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('wide, the facts sit beside the description', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { ref: { kind: 'mini-app', id: 'chess' } },
    })
    try {
      const page = view.host.querySelector('[data-store-page="chess"]')!
      expect(page.querySelector('aside [aria-label="Information"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a link to one listing opens its page', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { ref: { kind: 'mini-app', id: 'kanban' } },
    })
    try {
      expect(view.host.querySelector('[data-store-page="kanban"] h1')?.textContent).toBe('Kanban')
    } finally {
      await view.done()
    }
  })

  test('removed elsewhere, its page says it is gone instead of still showing Installed', async () => {
    const mine = listing({
      id: 'tracker',
      displayName: 'Tracker',
      installs: [{ scope: 'user' as const, version: '1.0.0', enabled: true }],
    })
    const view = await renderStore({ listings: [mine], target: { ref: mine.ref } })
    try {
      const page = () => view.host.querySelector<HTMLElement>('[data-store-page="tracker"]')
      expect(page()!.textContent).toContain('Installed')
      await view.change([])
      expect(page()).toBeNull()
      const gone = view.host.querySelector('[role="status"][aria-label="Not in the Store"]')
      expect(gone?.textContent).toContain('Tracker is no longer installed or offered')
      expect(view.host.querySelector('[data-store-back]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })
})
