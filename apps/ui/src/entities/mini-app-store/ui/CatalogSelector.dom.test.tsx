import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ADA, HOSTED, renderStore, storeEntry as entry } from '@/testing/miniAppStore'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const ENTRIES = [entry({ name: 'chess', displayName: 'Chess' })]
const CATALOGS = [
  { url: HOSTED, builtIn: true },
  { url: ADA, builtIn: false },
]
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const field = () =>
  dialog()?.querySelector<HTMLInputElement>('input[aria-label="Catalog address"]') ?? null

describe('the store’s catalogs', () => {
  test('a catalog someone added can be removed from its menu; the Localix one cannot', async () => {
    const view = await renderStore({ entries: ENTRIES, catalogs: CATALOGS })
    try {
      await view.openMenu(view.button('Catalogs: All catalogs'))
      expect(view.menuItem('Remove ada.test')).toBeDefined()
      expect(view.menuItems().some((item) => item.textContent?.includes('Remove Localix'))).toBe(
        false,
      )
      await view.click(view.menuItem('Remove ada.test'))
      expect(view.calls.catalogRemove).toEqual([ADA])
    } finally {
      await view.done()
    }
  })

  test('adding one reads it first and says who publishes it; nothing is added before Add', async () => {
    const view = await renderStore({ entries: ENTRIES, catalogs: CATALOGS })
    try {
      await view.openMenu(view.button('Catalogs: All catalogs'))
      await view.click(view.menuItem('Add catalog…'))
      expect(dialog()?.querySelector('h2')?.textContent).toBe('Add a catalog')
      await view.type(field(), 'https://bob.test/mini-app-catalog.json')
      await view.click(view.button('Read catalog', dialog()!))
      expect(view.calls.preview).toEqual(['https://bob.test/mini-app-catalog.json'])
      expect(dialog()?.textContent).toContain('Ada')
      expect(dialog()?.textContent).toContain('3 apps')
      expect(dialog()?.textContent).toContain('unverified')
      expect(view.calls.catalogAdd).toEqual([])
      await view.click(view.button('Add', dialog()!))
      expect(view.calls.catalogAdd).toEqual(['https://bob.test/mini-app-catalog.json'])
      expect(dialog()).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('an address that is not a catalog is refused inside the dialog, the text kept', async () => {
    const view = await renderStore({
      entries: ENTRIES,
      previewFails: 'The mini app catalog at broken.test answered 404',
    })
    try {
      await view.openMenu(view.button('Catalogs: All catalogs'))
      await view.click(view.menuItem('Add catalog…'))
      await view.type(field(), 'https://broken.test/c.json')
      await view.click(view.button('Read catalog', dialog()!))
      expect(dialog()?.textContent).toContain('answered 404')
      expect(field()?.value).toBe('https://broken.test/c.json')
      expect(view.button('Add', dialog()!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('a link to add a catalog opens the dialog with its address, waiting for a yes', async () => {
    const view = await renderStore({
      entries: ENTRIES,
      addCatalogUrl: 'https://bob.test/mini-app-catalog.json',
    })
    try {
      expect(field()?.value).toBe('https://bob.test/mini-app-catalog.json')
      expect(view.calls.preview).toEqual(['https://bob.test/mini-app-catalog.json'])
      expect(view.calls.catalogAdd).toEqual([])
    } finally {
      await view.done()
    }
  })
})
