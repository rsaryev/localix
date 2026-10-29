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
  listing({ id: 'puzzle', displayName: 'Puzzle', category: 'games' }),
  listing({ id: 'planner', displayName: 'Planner', category: 'utilities' }),
]
const COMMUNITY = listing({
  id: 'lint',
  displayName: 'Lint',
  ref: { kind: 'plugin', id: 'lint' },
  publisher: { name: 'Someone', verified: false },
  source: { id: 'ada/market', label: 'Ada’s market', trust: 'community' },
})

const alert = (host: ParentNode) => host.querySelector<HTMLElement>('[role="alert"]')

describe('when the Store cannot read', () => {
  test('a shelf says so and offers another try, instead of claiming nothing matches', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      failing: { page: true },
      target: { shelf: 'package:mini-app' },
    })
    try {
      expect(alert(view.host)?.textContent).toContain('could not be read')
      expect(view.host.textContent).not.toContain('Nothing here matches')
      view.recover()
      await view.click(view.button('Try again', view.host))
      expect(view.card('puzzle')).not.toBeNull()
      expect(alert(view.host)).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a search says so and offers another try', async () => {
    const view = await renderStore({ listings: LISTINGS, failing: { page: true } })
    try {
      await view.type(view.host.querySelector('input[aria-label="Search the Store"]'), 'puzzle')
      expect(alert(view.host)?.textContent).toContain('could not be read')
      expect(view.host.textContent).not.toContain('Nothing matches')
      view.recover()
      await view.click(view.button('Try again', view.host))
      expect(view.card('puzzle')).not.toBeNull()
    } finally {
      await view.done()
    }
  })

  test('Discover says so instead of loading forever, and reads again on request', async () => {
    const view = await renderStore({ listings: LISTINGS, failing: { discover: true } })
    try {
      expect(alert(view.host)?.textContent).toContain('could not be read')
      view.recover()
      await view.click(view.button('Try again', view.host))
      expect(alert(view.host)).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('a package page opened by address says so instead of loading forever', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      failing: { detail: true },
      target: { ref: { kind: 'mini-app', id: 'puzzle' } },
    })
    try {
      expect(alert(view.host)?.textContent).toContain('could not be read')
      view.recover()
      await view.click(view.button('Try again', view.host))
      expect(view.host.querySelector('[data-store-page] h1')?.textContent).toBe('Puzzle')
    } finally {
      await view.done()
    }
  })

  test('a page whose card was in hand still says its description could not be read', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      failing: { detail: true },
      target: { shelf: 'package:mini-app' },
    })
    try {
      await view.click(view.button('Puzzle', view.card('puzzle')!))
      expect(view.host.querySelector('[data-store-page] h1')?.textContent).toBe('Puzzle')
      expect(alert(view.host.querySelector('[data-store-page]')!)?.textContent).toContain(
        'could not be read',
      )
    } finally {
      await view.done()
    }
  })
})

describe('the consent sheet when what it runs cannot be read', () => {
  test('does not let Install through until the plan has been read', async () => {
    const view = await renderStore({
      listings: [COMMUNITY],
      failing: { plan: true },
      target: { shelf: 'package:plugin' },
    })
    try {
      await view.click(view.button('Get Lint', view.card('lint')!))
      const sheet = document.body.querySelector<HTMLElement>('[role="dialog"]')!
      expect(alert(sheet)?.textContent).toContain('could not be read')
      expect(view.button('Install', sheet)!.disabled).toBe(true)
      view.recover()
      await view.click(view.button('Try again', sheet))
      expect(view.button('Install', sheet)!.disabled).toBe(false)
      await view.click(view.button('Install', sheet))
      expect(view.calls).toEqual(['install plugin/lint user consent'])
    } finally {
      await view.done()
    }
  })
})
