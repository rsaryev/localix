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
    featured: true,
    contents: { screen: 1, command: 2 },
    components: [
      { kind: 'screen', name: 'Chess', description: 'A screen of its own' },
      { kind: 'command', name: '/chess:play', description: 'Start a game' },
      { kind: 'command', name: '/chess:hint' },
    ],
  }),
  listing({
    id: 'kanban',
    displayName: 'Kanban',
    category: 'utilities',
    contents: { screen: 1, command: 1 },
    components: [{ kind: 'command', name: '/kanban:plan', description: 'Plan the week' }],
    installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
  }),
  listing({ id: 'clock', displayName: 'Clock', contents: { screen: 1 } }),
]
const COMMANDS = { shelf: 'capability:command' }
const rows = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('[data-component]')].map((row) =>
    row.getAttribute('data-component'),
  )

describe('a capability shelf lists the components themselves', () => {
  test('one row per command, saying which package it comes from; no package groups', async () => {
    const view = await renderStore({ listings: LISTINGS, target: COMMANDS })
    try {
      expect(rows(view.host)).toEqual([
        'command:/chess:play',
        'command:/chess:hint',
        'command:/kanban:plan',
      ])
      const play = view.host.querySelector<HTMLElement>('[data-component="command:/chess:play"]')!
      expect(play.textContent).toContain('/chess:play')
      expect(play.textContent).toContain('Start a game')
      expect(play.textContent).toContain('In Chess · Mini app')
      expect(view.card('clock')).toBeNull()
      expect(view.host.querySelector('[aria-label="Categories"]')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a filter narrows the rows, and Installed only keeps the installed packages’ ones', async () => {
    const view = await renderStore({ listings: LISTINGS, target: COMMANDS })
    try {
      await view.type(view.host.querySelector('input[aria-label="Filter commands"]'), 'game')
      expect(rows(view.host)).toEqual(['command:/chess:play'])
      await view.type(view.host.querySelector('input[aria-label="Filter commands"]'), '')
      await view.click(view.button('Installed only'))
      expect(rows(view.host)).toEqual(['command:/kanban:plan'])
    } finally {
      await view.done()
    }
  })

  test('a row opens its package on What’s inside, with that component marked', async () => {
    const view = await renderStore({ listings: LISTINGS, target: COMMANDS })
    try {
      const play = view.host.querySelector<HTMLElement>('[data-component="command:/chess:play"]')!
      await view.click(view.button('/chess:play', play))
      const page = view.host.querySelector('[data-store-page="chess"]')!
      expect(page).not.toBeNull()
      expect(page.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
        'What’s inside',
      )
      expect(page.querySelector('li[aria-current="true"]')?.textContent).toContain('/chess:play')
    } finally {
      await view.done()
    }
  })

  test('getting from a row gets the whole package, which the row names', async () => {
    const view = await renderStore({ listings: LISTINGS, target: COMMANDS })
    try {
      const play = view.host.querySelector<HTMLElement>('[data-component="command:/chess:play"]')!
      expect(play.textContent).toContain('In Chess')
      await view.click(view.button('Get Chess', play))
      expect(view.calls).toEqual(['install mini-app/chess user'])
      const plan = view.host.querySelector<HTMLElement>('[data-component="command:/kanban:plan"]')!
      expect(plan.textContent).toContain('Installed')
      expect(view.button('Get Kanban', plan)).toBeUndefined()
    } finally {
      await view.done()
    }
  })
})

describe('Skills is one shelf: the skills a person has and those inside plugins', () => {
  const REVIEW = listing({
    id: 'user:review',
    ref: { kind: 'skill', id: 'user:review' },
    displayName: 'review',
    summary: 'Review a diff',
    source: { id: 'skills:yours', label: 'Your skills' },
    contents: { skill: 1 },
    authored: 'user',
    installs: [{ scope: 'user', enabled: true }],
  })
  const LINT = listing({
    id: 'lint',
    ref: { kind: 'plugin', id: 'lint' },
    displayName: 'Lint',
    contents: { skill: 2 },
    components: [
      { kind: 'skill', name: 'fix', description: 'Fix what lint found' },
      { kind: 'skill', name: 'explain' },
    ],
  })

  test('one Skills entry counts both, and the packages group names only mini apps and plugins', async () => {
    const view = await renderStore({
      listings: [REVIEW, LINT],
      target: { shelf: 'capability:skill' },
    })
    try {
      const nav = view.host.querySelector('nav[aria-label="Store sections"]')!
      const skills = [...nav.querySelectorAll('button')].filter((b) =>
        b.textContent?.startsWith('Skills'),
      )
      expect(skills).toHaveLength(1)
      expect(skills[0]!.textContent).toContain('3')
      expect(nav.querySelector('[role="group"][aria-label="Packages"]')?.textContent).toContain(
        'Plugins',
      )
      expect(nav.querySelector('[role="group"][aria-label="Packages"]')?.textContent).not.toContain(
        'Skills',
      )
      expect(nav.querySelector('[role="group"][aria-label="Capabilities"]')).toBeNull()
      expect(
        nav.querySelector('[role="group"][aria-label="What packages give"]')?.textContent,
      ).toContain('Skills')
    } finally {
      await view.done()
    }
  })

  test('each row says where it is from: its own source, or the plugin it is in', async () => {
    const view = await renderStore({
      listings: [REVIEW, LINT],
      target: { shelf: 'capability:skill' },
    })
    try {
      const mine = view.host.querySelector<HTMLElement>('[data-component="skill:review"]')!
      expect(mine.textContent).toContain('Review a diff')
      expect(mine.textContent).toContain('Your skills')
      expect(mine.textContent).not.toContain('In review')
      const fix = view.host.querySelector<HTMLElement>('[data-component="skill:fix"]')!
      expect(fix.textContent).toContain('In Lint · Plugin')
    } finally {
      await view.done()
    }
  })
})
