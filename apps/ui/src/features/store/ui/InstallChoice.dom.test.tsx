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

const chess = listing({
  id: 'chess',
  displayName: 'Chess',
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

describe('installing with or without an app of its own', () => {
  test('two icon buttons side by side: install, and install as an app, each named', async () => {
    const { extras, made } = appExtra()
    const view = await renderStore({ listings: [chess, notes], target: SHELF, extras })
    try {
      const card = () => view.card('chess')!
      expect(view.button('Install as app: Chess', card())).toBeDefined()
      await view.click(view.button('Install Chess', card()))
      expect(view.calls).toEqual(['install mini-app/chess user'])
      expect(made).toEqual([])
      expect(view.button('Install as app: Chess', card())).toBeDefined()
      expect(view.button('Install as app: Notes', view.card('notes')!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('a listing’s page has both, labelled: Install, and the extra’s own action', async () => {
    const { extras, made } = appExtra()
    const view = await renderStore({ listings: [chess], target: SHELF, extras })
    try {
      await view.click(view.button('Chess', view.card('chess')!))
      const page = view.host.querySelector('[data-store-page="chess"]')!
      expect(view.button('Install', page)).toBeDefined()
      await view.click(view.button('Install as app', page))
      expect(view.calls).toEqual(['install mini-app/chess user'])
      await view.change([landed(chess)])
      expect(made).toEqual(['chess'])
    } finally {
      await view.done()
    }
  })

  test('the Store draws whatever extra it is given, in its own words', async () => {
    const synced = installExtra()
    const extras = [{ ...synced.extra, id: 'sync', label: 'Install and sync', makes: 'sync' }]
    const view = await renderStore({ listings: [chess], target: SHELF, extras })
    try {
      await view.click(view.button('Install and sync: Chess', view.card('chess')!))
      await view.change([landed(chess)])
      expect(synced.made).toEqual(['chess'])
    } finally {
      await view.done()
    }
  })

  test('where no app can be made, the action is a plain Install', async () => {
    const view = await renderStore({ listings: [chess], target: SHELF })
    try {
      await view.click(view.button('Install Chess', view.card('chess')!))
      expect(view.calls).toEqual(['install mini-app/chess user'])
      expect(view.button('Install as app: Chess')).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('with the app chosen, it is made once the install has landed, and only once', async () => {
    const { extras, made } = appExtra()
    const view = await renderStore({ listings: [chess], target: SHELF, extras })
    try {
      await view.click(view.button('Install as app: Chess', view.card('chess')!))
      expect(view.calls).toEqual(['install mini-app/chess user'])
      expect(made).toEqual([])
      await view.change([
        { ...chess, job: { action: 'install', phase: 'downloading', received: 1, total: 4 } },
      ])
      expect(made).toEqual([])
      await view.change([landed(chess)])
      expect(made).toEqual(['chess'])
      await view.change([landed(chess)])
      expect(made).toEqual(['chess'])
    } finally {
      await view.done()
    }
  })

  test('an app that cannot be made leaves the install, and says why in the card', async () => {
    const { extras } = appExtra({ fails: 'Chess has no icon of its own' })
    const view = await renderStore({ listings: [chess], target: SHELF, extras })
    try {
      await view.click(view.button('Install as app: Chess', view.card('chess')!))
      await view.change([landed(chess)])
      expect(view.calls).toEqual(['install mini-app/chess user'])
      expect(view.card('chess')?.textContent).toContain(
        'Installed, but the desktop app was not made: Chess has no icon of its own',
      )
    } finally {
      await view.done()
    }
  })

  test('an installed listing’s page adds or removes its app', async () => {
    const without = appExtra()
    const first = await renderStore({
      listings: [landed(chess)],
      target: SHELF,
      extras: without.extras,
    })
    try {
      await first.click(first.button('Chess', first.card('chess')!))
      await first.click(first.button('Add desktop app'))
      expect(without.made).toEqual(['chess'])
    } finally {
      await first.done()
    }
    const withApp = appExtra({ has: ['chess'] })
    const second = await renderStore({
      listings: [landed(chess)],
      target: SHELF,
      extras: withApp.extras,
    })
    try {
      await second.click(second.button('Chess', second.card('chess')!))
      expect(second.button('Add desktop app')).toBeUndefined()
      await second.click(second.button('Remove desktop app'))
      expect(withApp.removed).toEqual(['chess'])
    } finally {
      await second.done()
    }
  })
})
