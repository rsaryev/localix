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

describe('a listing’s page', () => {
  test('opens from its card: icon, name, publisher, category, tags, version and action', async () => {
    const { view, page } = await open()
    try {
      expect(page()!.querySelector('h1')?.textContent).toBe('Chess')
      expect(page()!.querySelector('img')?.getAttribute('src')).toEndWith('/chess/icon')
      expect(page()!.textContent).toContain('Localix')
      expect(page()!.querySelector('[aria-label="Verified publisher"]')).not.toBeNull()
      expect(page()!.textContent).toContain('Games')
      expect(page()!.textContent).toContain('board-game')
      expect(page()!.textContent).toContain('1.0.0')
      await view.click(view.button('Install', page()!))
      expect(view.calls).toEqual(['install mini-app/chess user'])
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

  test('Overview is the README without its raw HTML, with the facts beside it', async () => {
    const { view, page } = await open()
    try {
      const about = page()!.querySelector('[role="tabpanel"]')!
      expect(about.querySelector('strong')?.textContent).toBe('real')
      expect(about.querySelector('b')).toBeNull()
      expect(about.textContent).toContain('MIT')
      expect(about.querySelector('a[href="https://example.test/chess"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('What’s inside lists its parts; Permissions is the plan', async () => {
    const { view, page, tab } = await open()
    try {
      await view.click(tab('What’s inside'))
      const panel = () => page()!.querySelector('[role="tabpanel"]')!
      expect(panel().textContent).toContain('A screen of its own')
      expect(panel().textContent).toContain('/chess:play')
      await view.click(tab('Permissions'))
      expect(panel().textContent).toContain('Runs on this computer')
      expect(panel().textContent).toContain('Chess')
    } finally {
      await view.done()
    }
  })

  test('an unverified publisher’s plan warns before anything is installed', async () => {
    const { view, page, tab } = await open('radio', 'Radio')
    try {
      await view.click(tab('Permissions'))
      expect(page()!.textContent).toContain('Someone is not a publisher Localix verifies')
      await view.click(view.button('Install', page()!))
      expect(view.calls).toEqual([])
      await view.click(view.button('Install anyway', page()!))
      expect(view.calls).toEqual(['install mini-app/radio user consent'])
    } finally {
      await view.done()
    }
  })

  test('Back returns to the shelf with its filter kept', async () => {
    const view = await renderStore({ listings: LISTINGS, target: { shelf: 'package:mini-app' } })
    try {
      await view.click(view.button('Show packages tagged game'))
      expect(view.card('kanban')).toBeNull()
      await view.click(view.button('Chess', view.card('chess')!))
      await view.click(view.button('Back to the store'))
      expect(view.card('chess')).not.toBeNull()
      expect(view.card('kanban')).toBeNull()
      expect(view.button('Remove the tag filter game')).toBeDefined()
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
})
