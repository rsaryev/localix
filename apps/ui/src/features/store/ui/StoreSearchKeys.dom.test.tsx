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
  listing({ id: 'puzzle', displayName: 'Puzzle', summary: 'Play board games' }),
  listing({ id: 'quiz', displayName: 'Quiz', summary: 'Play board games too' }),
  listing({ id: 'planner', displayName: 'Planner', summary: 'Tasks on a board' }),
]

const field = (host: ParentNode) =>
  host.querySelector<HTMLInputElement>('input[aria-label="Search the Store"]')

describe('searching the Store', () => {
  test('Escape in the search field clears it and goes back to what was open', async () => {
    const view = await renderStore({ listings: LISTINGS })
    try {
      await view.type(field(view.host), 'puzzle')
      expect(view.host.textContent).toContain('Results for')
      await view.press('Escape', field(view.host))
      expect(field(view.host)!.value).toBe('')
      expect(view.host.textContent).not.toContain('Results for')
    } finally {
      await view.done()
    }
  })

  test('Escape in a dialog opened from a result does not clear the search', async () => {
    const view = await renderStore({
      listings: [
        listing({
          id: 'lint',
          displayName: 'Lint',
          ref: { kind: 'plugin', id: 'lint' },
          publisher: { name: 'Someone', verified: false },
          source: { id: 'ada/market', label: 'Ada’s market', trust: 'community' },
        }),
      ],
    })
    try {
      await view.type(field(view.host), 'lint')
      await view.click(view.button('Get Lint', view.card('lint')!))
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
      await view.press('Escape', document.body.querySelector('[role="dialog"]'))
      expect(field(view.host)!.value).toBe('lint')
    } finally {
      await view.done()
    }
  })

  test('a screen reader is told how many packages were found', async () => {
    const view = await renderStore({ listings: LISTINGS })
    try {
      await view.type(field(view.host), 'board')
      expect(view.host.querySelector('[role="status"]')?.textContent).toContain('3 results')
      await view.type(field(view.host), 'puzzle')
      expect(view.host.querySelector('[role="status"]')?.textContent).toContain('1 result')
    } finally {
      await view.done()
    }
  })

  test('refining the words keeps the filters that were chosen', async () => {
    const view = await renderStore({
      listings: LISTINGS.map(
        (l) => ({ ...l, installs: [{ scope: 'user', version: '1' }] }) as never,
      ),
    })
    try {
      await view.type(field(view.host), 'ch')
      // The filter under the search, not the Installed section's tab.
      const results = view.host.querySelector<HTMLElement>('[data-store-scroller]')!
      await view.click(view.button('Installed', results))
      const pill = () => view.button('Installed', results)!
      expect(pill().getAttribute('aria-pressed')).toBe('true')
      await view.type(field(view.host), 'che')
      expect(pill().getAttribute('aria-pressed')).toBe('true')
    } finally {
      await view.done()
    }
  })

  test('when the filters leave nothing, one press clears them', async () => {
    const view = await renderStore({ listings: LISTINGS })
    try {
      await view.type(field(view.host), 'puzzle')
      // The filter under the search, not the Installed section's tab.
      const results = view.host.querySelector<HTMLElement>('[data-store-scroller]')!
      await view.click(view.button('Installed', results))
      expect(view.host.textContent).toContain('Nothing matches')
      await view.click(view.button('Clear filters', view.host))
      expect(view.card('puzzle')).not.toBeNull()
    } finally {
      await view.done()
    }
  })
})
