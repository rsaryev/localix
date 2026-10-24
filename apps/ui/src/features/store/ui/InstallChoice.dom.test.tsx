import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Listing } from '@localixai/store'
import { registerDom } from '@localixai/kit/testing/dom'
import type { StoreAppExtra } from '@/shared/lib/storeAppExtra'
import { listing, renderStore } from '@/testing/store'

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

/** An app of its own for listings with a screen, recording what was asked of it. */
function appExtra(opts: { has?: string[]; fails?: string } = {}) {
  const made: string[] = []
  const removed: string[] = []
  const extra: StoreAppExtra = {
    available: (l) => (l.contents === 'unknown' ? false : Boolean(l.contents.screen)),
    has: (l) => (opts.has ?? []).includes(l.ref.id),
    make: async (l) => {
      made.push(l.ref.id)
      if (opts.fails) throw new Error(opts.fails)
    },
    remove: async (l) => void removed.push(l.ref.id),
  }
  return { extra, made, removed }
}

describe('installing with or without an app of its own', () => {
  test('two icon buttons side by side: install, and install as an app, each named', async () => {
    const { extra, made } = appExtra()
    const view = await renderStore({ listings: [chess, notes], target: SHELF, extra })
    try {
      const card = () => view.card('chess')!
      expect(view.button('Install Chess as an app', card())).toBeDefined()
      await view.click(view.button('Install Chess', card()))
      expect(view.calls).toEqual(['install mini-app/chess user'])
      expect(made).toEqual([])
      expect(view.button('Install Chess as an app', card())).toBeDefined()
      expect(view.button('Install Notes as an app', view.card('notes')!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('where no app can be made, the action is a plain Install', async () => {
    const view = await renderStore({ listings: [chess], target: SHELF })
    try {
      await view.click(view.button('Install Chess', view.card('chess')!))
      expect(view.calls).toEqual(['install mini-app/chess user'])
      expect(view.button('Install Chess as an app')).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('with the app chosen, it is made once the install has landed, and only once', async () => {
    const { extra, made } = appExtra()
    const view = await renderStore({ listings: [chess], target: SHELF, extra })
    try {
      await view.click(view.button('Install Chess as an app', view.card('chess')!))
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
    const { extra } = appExtra({ fails: 'Chess has no icon of its own' })
    const view = await renderStore({ listings: [chess], target: SHELF, extra })
    try {
      await view.click(view.button('Install Chess as an app', view.card('chess')!))
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
      extra: without.extra,
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
      extra: withApp.extra,
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
