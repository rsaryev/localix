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
    id: 'review',
    displayName: 'Code review',
    ref: { kind: 'plugin', id: 'review' },
    category: 'Development',
    summary: 'Review a pull request',
    contents: { skill: 1, command: 1 },
    components: [
      { kind: 'skill', name: 'review-pr', description: 'Review a pull request, file by file' },
      { kind: 'command', name: '/review:start' },
    ],
    source: { id: 'official', label: 'Official', trust: 'official' },
  }),
  listing({
    id: 'reviewer',
    displayName: 'Reviewer',
    category: 'Productivity',
    summary: 'Review tasks',
    installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
  }),
  listing({ id: 'chess', displayName: 'Chess', category: 'Games' }),
]
const DISCOVER = { categories: [{ id: 'Games', label: 'Games', count: 1 }] }

async function search(text: string) {
  const view = await renderStore({ listings: LISTINGS, discover: DISCOVER })
  const input = () =>
    view.host.querySelector<HTMLInputElement>('input[aria-label="Search the Store"]')
  await view.type(input(), text)
  const results = () => view.host.querySelector<HTMLElement>('[data-store-scroller]')!
  return { view, input, results }
}

describe('the Store’s search results', () => {
  test('say what was asked, and group the packages found with what is inside packages', async () => {
    const { view, results } = await search('review')
    try {
      expect(results().querySelector('h2')?.textContent).toBe('Results for “review”')
      const packages = results().querySelector('section[aria-label="Packages"]')!
      expect(packages.textContent).toContain('Code review')
      expect(packages.textContent).toContain('Reviewer')
      expect(packages.textContent).not.toContain('Chess')
      const inside = results().querySelector('section[aria-label="Inside packages"]')!
      expect(inside.textContent).toContain('review-pr')
      expect(inside.textContent).toContain('Skill in Code review')
      expect(view.reads.at(-1)).toContain('q=review')
    } finally {
      await view.done()
    }
  })

  test('a component hit opens its package on What’s inside, the component marked', async () => {
    const { view, results } = await search('review')
    try {
      await view.click(
        view.button(
          'review-pr, in Code review',
          results().querySelector('[aria-label="Inside packages"]')!,
        ),
      )
      const page = view.host.querySelector('[data-store-page="review"]')!
      expect(page.querySelector('li[aria-current="true"]')?.textContent).toContain('review-pr')
    } finally {
      await view.done()
    }
  })

  test('filters narrow the results as chips: kind, source, trust and installed', async () => {
    const { view, results } = await search('review')
    try {
      await view.openMenu(view.button('Kind'))
      await view.click(view.menuItem('Plugins'))
      expect(view.button('Kind: Plugins')).toBeDefined()
      expect(view.reads.at(-1)).toContain('shelf=package:plugin')
      expect(results().querySelector('[data-listing="reviewer"]')).toBeNull()
      await view.click(view.button('Clear kind'))
      await view.openMenu(view.button('Trust'))
      await view.click(view.menuItem('Official'))
      expect(view.reads.at(-1)).toContain('trust=official')
      await view.click(view.button('Clear trust'))
      await view.click(view.button('Installed', view.host.querySelector('[aria-label="Filters"]')!))
      expect(view.reads.at(-1)).toContain('installed=true')
      expect(results().querySelector('[data-listing="reviewer"]')).not.toBeNull()
      expect(results().querySelector('[data-listing="review"]')).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('nothing found says so and suggests the categories', async () => {
    const { view, results } = await search('zzz')
    try {
      expect(results().textContent).toContain('Nothing matches “zzz”')
      await view.click(view.button('Games', results()))
      expect(view.host.querySelector('h2')?.textContent).toBe('Games')
    } finally {
      await view.done()
    }
  })

  test('clearing the search returns to where the person was', async () => {
    const { view, input, results } = await search('review')
    try {
      await view.type(input(), '')
      expect(results().querySelector('h2')?.textContent).not.toContain('Results for')
      expect(view.host.querySelector('[aria-current="page"]')?.textContent).toContain('Discover')
    } finally {
      await view.done()
    }
  })

  test('narrow, results are one column', async () => {
    const view = await renderStore({ listings: LISTINGS, discover: DISCOVER, width: 600 })
    try {
      await view.type(
        view.host.querySelector<HTMLInputElement>('input[aria-label="Search the Store"]'),
        'review',
      )
      const rows = view.host.querySelector<HTMLElement>('[data-index="0"]')!
      expect(rows.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))')
    } finally {
      await view.done()
    }
  })
})
