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
    id: 'puzzle',
    displayName: 'Puzzle',
    category: 'games',
    version: '1.0.0',
    icon: '/rpc/mini-apps/store/media/puzzle/icon',
    tags: ['game', 'board-game'],
    contents: { screen: 1, command: 1 },
  }),
  listing({ id: 'planner', displayName: 'Planner', category: 'utilities', tags: ['tasks'] }),
  listing({
    id: 'radio',
    displayName: 'Radio',
    publisher: { name: 'Someone', verified: false },
    tags: ['music'],
  }),
]

async function open(id = 'puzzle', name = 'Puzzle') {
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
      expect(page()!.querySelector('h1')?.textContent).toBe('Puzzle')
      expect(page()!.querySelector('img')?.getAttribute('src')).toEndWith('/puzzle/icon')
      expect(page()!.textContent).toContain('Localix')
      expect(page()!.querySelector('[aria-label="Verified · Localix"]')).not.toBeNull()
      expect(page()!.textContent).toContain('games')
      expect(view.button('Show packages tagged board-game', page()!)).toBeDefined()
      await view.click(view.button('Get Puzzle', page()!))
      expect(view.calls).toEqual(['install mini-app/puzzle user'])
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
      expect(facts.querySelector('a[href="https://example.test/puzzle"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('its screenshots page, and one opens full-window, paged with the arrows', async () => {
    const { view, page, shown } = await open()
    try {
      expect(shown()).toEndWith('/puzzle/screenshot/0')
      expect(page()!.textContent).toContain('The board')
      await view.click(view.button('Next screenshot'))
      expect(shown()).toEndWith('/puzzle/screenshot/1')
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
      expect(panel().textContent).toContain('/puzzle:play')
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

  test('What’s inside groups the parts by what they are, each row saying what it does', async () => {
    const kit = listing({
      id: 'kit',
      displayName: 'Kit',
      ref: { kind: 'plugin', id: 'kit' },
      components: [
        { kind: 'hook', name: 'PostToolUse' },
        { kind: 'skill', name: 'install', description: 'Install a mini app from its folder' },
        { kind: 'agent', name: 'reviewer', description: 'Reviews a mini app' },
        { kind: 'skill', name: 'check' },
        { kind: 'command', name: '/kit:new', description: 'Start a mini app' },
      ],
    })
    const view = await renderStore({ listings: [kit], target: { shelf: 'package:plugin' } })
    try {
      await view.click(view.button('Kit', view.card('kit')!))
      const panel = view.host.querySelector('[data-store-page="kit"] [role="tabpanel"]')!
      const groups = [...panel.querySelectorAll('section')].map((group) => ({
        heading: group.querySelector('h3')?.textContent,
        rows: [...group.querySelectorAll('li')].map((row) => row.textContent),
      }))
      expect(groups).toEqual([
        { heading: 'Command', rows: ['/kit:newStart a mini app'] },
        { heading: 'Skills · 2', rows: ['installInstall a mini app from its folder', 'check'] },
        { heading: 'Agent', rows: ['reviewerReviews a mini app'] },
        { heading: 'Hook', rows: ['PostToolUseAfter each tool the agent uses'] },
      ])
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
      await view.click(view.button('Puzzle', view.card('puzzle')!))
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
      expect(view.card('planner')).toBeNull()
      await view.click(view.button('Puzzle', view.card('puzzle')!))
      expect(view.host.querySelector('[data-store-page="puzzle"]')).not.toBeNull()
      await view.click(view.button(/^Back to /))
      expect(view.card('puzzle')).not.toBeNull()
      expect(view.card('planner')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('removed while its page is open, Back finds the shelf no longer calling it Installed', async () => {
    const installed = [{ scope: 'user' as const, version: '1.0.0', enabled: true }]
    const view = await renderStore({
      listings: LISTINGS.map((it) =>
        it.ref.id === 'planner' ? { ...it, installs: installed } : it,
      ),
      target: { shelf: 'package:mini-app' },
    })
    try {
      expect(view.card('planner')!.textContent).toContain('Installed')
      await view.click(view.button('Planner', view.card('planner')!))
      await view.change(LISTINGS)
      await view.click(view.button(/^Back to /))
      expect(view.card('planner')!.textContent).not.toContain('Installed')
    } finally {
      await view.done()
    }
  })

  test('a tag opens a list of what carries it, and Back returns to the page', async () => {
    const { view, page } = await open()
    try {
      await view.click(view.button('Show packages tagged game', page()!))
      expect(view.host.querySelector('h2')?.textContent).toBe('Tagged “game”')
      expect(view.card('puzzle')).not.toBeNull()
      expect(view.card('planner')).toBeNull()
      await view.click(view.button(/^Back to /))
      expect(page()).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('narrow, Get stays in the header and the facts go under the header', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { ref: { kind: 'mini-app', id: 'puzzle' } },
      width: 600,
    })
    try {
      const page = view.host.querySelector('[data-store-page="puzzle"]')!
      const header = page.querySelector('header')!
      expect(view.button('Get Puzzle', header)).toBeDefined()
      // One Get on the page, where the eye already is: no second bar pinned to the bottom.
      expect(page.querySelectorAll('button[aria-label="Get Puzzle"]')).toHaveLength(1)
      expect(page.querySelectorAll('[aria-label="Information"]')).toHaveLength(1)
      expect(page.querySelector('aside')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('wide, the facts sit beside the description', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { ref: { kind: 'mini-app', id: 'puzzle' } },
    })
    try {
      const page = view.host.querySelector('[data-store-page="puzzle"]')!
      expect(page.querySelector('aside [aria-label="Information"]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a link to one listing opens its page', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { ref: { kind: 'mini-app', id: 'planner' } },
    })
    try {
      expect(view.host.querySelector('[data-store-page="planner"] h1')?.textContent).toBe('Planner')
    } finally {
      await view.done()
    }
  })

  test('removed while its page is open, the Store steps back to where the page was opened from', async () => {
    const mine = listing({
      id: 'tracker',
      displayName: 'Tracker',
      installs: [{ scope: 'user' as const, version: '1.0.0', enabled: true }],
    })
    const view = await renderStore({
      listings: [mine, ...LISTINGS],
      target: { shelf: 'package:mini-app' },
    })
    try {
      await view.click(view.button('Tracker', view.card('tracker')!))
      const page = () => view.host.querySelector<HTMLElement>('[data-store-page="tracker"]')
      expect(page()!.textContent).toContain('Installed')
      await view.change(LISTINGS)
      expect(page()).toBeNull()
      expect(view.host.querySelector('[aria-label="Not in the Store"]')).toBeNull()
      expect(view.card('planner')).not.toBeNull()
      expect(view.card('tracker')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('opened at a package that is already gone, its page says so', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { ref: { kind: 'mini-app', id: 'tracker' } },
    })
    try {
      const gone = view.host.querySelector('[role="status"][aria-label="Not in the Store"]')
      expect(gone?.textContent).toContain('tracker is no longer installed or offered')
      expect(view.host.querySelector('[data-store-back]')).not.toBeNull()
    } finally {
      await view.done()
    }
  })
})
