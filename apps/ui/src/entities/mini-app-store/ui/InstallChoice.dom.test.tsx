import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { renderStore, storeEntry as entry } from '@/testing/miniAppStore'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const chess = entry({
  name: 'chess',
  displayName: 'Chess',
  category: 'games',
  version: '1.0.0',
  surfaces: ['agent', 'workbench'],
})
const notes = entry({ name: 'notes', displayName: 'Notes', category: 'utilities' })
const withScreen = (candidate: { surfaces?: string[] }) =>
  Boolean(candidate.surfaces?.includes('workbench'))

describe('installing with or without the desktop app', () => {
  test('Install alone installs in Localix; the menu offers both, with what the desktop app adds', async () => {
    const view = await renderStore({ entries: [chess], desktopAvailable: withScreen })
    try {
      await view.click(view.button('Install', view.row('chess')!))
      expect(view.calls.install.map(({ name }) => name)).toEqual(['chess'])
      expect(view.calls.desktopInstall).toEqual([])

      await view.openMenu(view.button('More ways to install Chess'))
      expect(view.menuItems().map((item) => item.querySelector('.truncate')?.textContent)).toEqual([
        'Install',
        'Install with desktop app',
      ])
      expect(view.menuItem('Install with desktop app')?.textContent).toContain(
        'Also adds it as an app with its own window, Dock icon and place in Spotlight',
      )
    } finally {
      await view.done()
    }
  })

  test('where no desktop app can be made, the action is a plain Install', async () => {
    const elsewhere = await renderStore({ entries: [chess] })
    try {
      expect(elsewhere.button('More ways to install Chess')).toBeUndefined()
      expect(elsewhere.button('Install', elsewhere.row('chess')!)).toBeDefined()
    } finally {
      await elsewhere.done()
    }
    const noScreen = await renderStore({ entries: [notes], desktopAvailable: withScreen })
    try {
      expect(noScreen.button('More ways to install Notes')).toBeUndefined()
    } finally {
      await noScreen.done()
    }
  })

  test('with the desktop app, it is made once the install has landed', async () => {
    const view = await renderStore({ entries: [chess], desktopAvailable: withScreen })
    try {
      await view.openMenu(view.button('More ways to install Chess'))
      await view.click(view.menuItem('Install with desktop app'))
      expect(view.calls.install.map(({ name }) => name)).toEqual(['chess'])
      expect(view.calls.desktopInstall).toEqual([])

      await view.rerender([{ ...chess, job: { phase: 'downloading', received: 1, total: 4 } }])
      expect(view.calls.desktopInstall).toEqual([])
      await view.rerender([{ ...chess, installed: { version: '1.0.0' }, job: { phase: 'done' } }])
      expect(view.calls.desktopInstall).toEqual(['chess'])
      await view.rerender([{ ...chess, installed: { version: '1.0.0' }, job: { phase: 'done' } }])
      expect(view.calls.desktopInstall).toEqual(['chess'])
    } finally {
      await view.done()
    }
  })

  test('a desktop app that cannot be made leaves the install, and says why in the row', async () => {
    const view = await renderStore({
      entries: [chess],
      desktopAvailable: withScreen,
      desktopFails: 'Chess has no icon of its own',
    })
    try {
      await view.openMenu(view.button('More ways to install Chess'))
      await view.click(view.menuItem('Install with desktop app'))
      await view.rerender([{ ...chess, installed: { version: '1.0.0' }, job: { phase: 'done' } }])
      expect(view.calls.remove).toEqual([])
      expect(view.row('chess')?.textContent).toContain(
        'Installed, but the desktop app was not made: Chess has no icon of its own',
      )
    } finally {
      await view.done()
    }
  })

  test('an installed app’s page adds or removes its desktop app', async () => {
    const installed = { ...chess, installed: { version: '1.0.0' } }
    const without = await renderStore({ entries: [installed], desktopAvailable: withScreen })
    try {
      await without.click(without.button('Chess', without.row('chess')!))
      await without.click(without.button('Add desktop app'))
      expect(without.calls.desktopInstall).toEqual(['chess'])
    } finally {
      await without.done()
    }
    const withApp = await renderStore({
      entries: [installed],
      desktopAvailable: withScreen,
      desktopInstalled: ['chess'],
    })
    try {
      await withApp.click(withApp.button('Chess', withApp.row('chess')!))
      expect(withApp.button('Add desktop app')).toBeUndefined()
      await withApp.click(withApp.button('Remove desktop app'))
      expect(withApp.calls.desktopRemove).toEqual(['chess'])
    } finally {
      await withApp.done()
    }
  })
})
