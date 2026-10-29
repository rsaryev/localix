import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Listing } from '@localixai/store'
import { registerDom } from '@localixai/kit/testing/dom'
import { installExtra, listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const puzzle = listing({
  id: 'puzzle',
  displayName: 'Puzzle',
  version: '1.0.0',
  contents: { screen: 1 },
})
const notes = listing({ id: 'notes', displayName: 'Notes' })
const SHELF = { shelf: 'package:mini-app' }
const landed = (l: Listing): Listing => ({
  ...l,
  installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
  job: { action: 'install', phase: 'done' },
})

const appExtra = (opts: Parameters<typeof installExtra>[0] = {}) => {
  const made = installExtra(opts)
  return { ...made, extras: [made.extra] }
}

const page = (view: Awaited<ReturnType<typeof renderStore>>) =>
  view.host.querySelector<HTMLElement>('[data-store-page="puzzle"]')!

describe('getting with or without an app of its own', () => {
  test('on a package’s page, Get and the extra sit side by side, each named', async () => {
    const { extras, made } = appExtra()
    const view = await renderStore({ listings: [puzzle, notes], target: SHELF, extras })
    try {
      // A row has the one control; the extra is offered on the page, where there is room to say it.
      expect(view.button('Install as app: Puzzle', view.card('puzzle')!)).toBeUndefined()
      await view.click(view.button('Puzzle', view.card('puzzle')!))
      expect(view.button('Install as app: Puzzle', page(view))).toBeDefined()
      await view.click(view.button('Get Puzzle', page(view)))
      expect(view.calls).toEqual(['install mini-app/puzzle user'])
      expect(made).toEqual([])
    } finally {
      await view.done()
    }
  })

  test('the Store draws whatever extra it is given, in its own words', async () => {
    const synced = installExtra()
    const extras = [{ ...synced.extra, id: 'sync', label: 'Install and sync', makes: 'sync' }]
    const view = await renderStore({ listings: [puzzle], target: SHELF, extras })
    try {
      await view.click(view.button('Puzzle', view.card('puzzle')!))
      await view.click(view.button('Install and sync: Puzzle', page(view)))
      await view.change([landed(puzzle)])
      expect(synced.made).toEqual(['puzzle'])
    } finally {
      await view.done()
    }
  })

  test('where no app can be made, the page offers Get alone', async () => {
    const view = await renderStore({ listings: [puzzle], target: SHELF })
    try {
      await view.click(view.button('Puzzle', view.card('puzzle')!))
      await view.click(view.button('Get Puzzle', page(view)))
      expect(view.calls).toEqual(['install mini-app/puzzle user'])
      expect(view.button('Install as app: Puzzle')).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('with the app chosen, it is made once the install has landed, and only once', async () => {
    const { extras, made } = appExtra()
    const view = await renderStore({ listings: [puzzle], target: SHELF, extras })
    try {
      await view.click(view.button('Puzzle', view.card('puzzle')!))
      await view.click(view.button('Install as app: Puzzle', page(view)))
      expect(view.calls).toEqual(['install mini-app/puzzle user'])
      expect(made).toEqual([])
      await view.change([
        { ...puzzle, job: { action: 'install', phase: 'downloading', received: 1, total: 4 } },
      ])
      expect(made).toEqual([])
      await view.change([landed(puzzle)])
      expect(made).toEqual(['puzzle'])
      await view.change([landed(puzzle)])
      expect(made).toEqual(['puzzle'])
    } finally {
      await view.done()
    }
  })

  test('an app that cannot be made leaves the install, and says why on the page', async () => {
    const { extras } = appExtra({ fails: 'Puzzle has no icon of its own' })
    const view = await renderStore({ listings: [puzzle], target: SHELF, extras })
    try {
      await view.click(view.button('Puzzle', view.card('puzzle')!))
      await view.click(view.button('Install as app: Puzzle', page(view)))
      await view.change([landed(puzzle)])
      expect(view.calls).toEqual(['install mini-app/puzzle user'])
      expect(page(view).querySelector('[role="alert"]')?.textContent).toBe(
        'The desktop app was not made: Puzzle has no icon of its own',
      )
    } finally {
      await view.done()
    }
  })

  test('an installed package’s menu adds or removes its app', async () => {
    const without = appExtra()
    const first = await renderStore({
      listings: [landed(puzzle)],
      target: SHELF,
      extras: without.extras,
    })
    try {
      await first.click(first.button('Puzzle', first.card('puzzle')!))
      await first.openMenu(first.button('Puzzle options'))
      await first.click(first.menuItem('Add desktop app'))
      expect(without.made).toEqual(['puzzle'])
    } finally {
      await first.done()
    }
    const withApp = appExtra({ has: ['puzzle'] })
    const second = await renderStore({
      listings: [landed(puzzle)],
      target: SHELF,
      extras: withApp.extras,
    })
    try {
      await second.click(second.button('Puzzle', second.card('puzzle')!))
      await second.openMenu(second.button('Puzzle options'))
      expect(second.menuItem('Add desktop app')).toBeUndefined()
      await second.click(second.menuItem('Remove desktop app'))
      expect(withApp.removed).toEqual(['puzzle'])
    } finally {
      await second.done()
    }
  })
})
