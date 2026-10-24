import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ADA, HOSTED, listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const LISTINGS = [listing({ id: 'chess', displayName: 'Chess' })]
const SOURCES = [
  { kind: 'mini-app' as const, id: HOSTED, label: 'Localix', url: HOSTED, builtIn: true, count: 1 },
  { kind: 'mini-app' as const, id: ADA, label: 'ada.test', url: ADA, builtIn: false, count: 0 },
]
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const field = () =>
  dialog()?.querySelector<HTMLInputElement>('input[aria-label="Source address"]') ?? null

describe('the Store’s sources', () => {
  test('Sources lists each provider’s sources; one someone added is removed, Localix’s stays', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      sources: SOURCES,
      target: { shelf: 'sources' },
    })
    try {
      const group = view.host.querySelector('section[aria-label="Mini app catalogs"]')!
      expect(group.textContent).toContain('Localix')
      expect(group.textContent).toContain('Comes with Localix')
      expect(group.textContent).toContain('ada.test')
      expect(view.button('Remove Localix')).toBeUndefined()
      await view.click(view.button('Remove ada.test'))
      expect(view.calls).toEqual([`remove source mini-app ${ADA}`])
    } finally {
      await view.done()
    }
  })

  test('the shelf’s source menu removes one someone added; the Localix one cannot be', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      sources: SOURCES,
      target: { shelf: 'package:mini-app' },
    })
    try {
      await view.openMenu(view.button('Sources: All sources'))
      expect(view.menuItem('Remove ada.test')).toBeDefined()
      expect(view.menuItems().some((item) => item.textContent?.includes('Remove Localix'))).toBe(
        false,
      )
      await view.click(view.menuItem('Remove ada.test'))
      expect(view.calls).toEqual([`remove source mini-app ${ADA}`])
    } finally {
      await view.done()
    }
  })

  test('adding one reads it first and says who publishes it; nothing is added before Add', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      sources: SOURCES,
      target: { shelf: 'sources' },
    })
    try {
      await view.click(view.button('Add a mini app catalog…'))
      expect(dialog()?.querySelector('h2')?.textContent).toBe('Add a mini app catalog')
      await view.type(field(), 'https://bob.test/mini-app-catalog.json')
      await view.click(view.button('Read', dialog()!))
      expect(view.calls).toEqual(['preview mini-app https://bob.test/mini-app-catalog.json'])
      expect(dialog()?.textContent).toContain('Ada')
      expect(dialog()?.textContent).toContain('3 packages')
      expect(dialog()?.textContent).toContain('unverified')
      await view.click(view.button('Add', dialog()!))
      expect(view.calls.at(-1)).toBe('add source mini-app https://bob.test/mini-app-catalog.json')
      expect(dialog()).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('an address that is not a source is refused inside the dialog, the text kept', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { shelf: 'sources' },
      previewFails: 'The mini app catalog at broken.test answered 404',
    })
    try {
      await view.click(view.button('Add a mini app catalog…'))
      await view.type(field(), 'https://broken.test/c.json')
      await view.click(view.button('Read', dialog()!))
      expect(dialog()?.textContent).toContain('answered 404')
      expect(field()?.value).toBe('https://broken.test/c.json')
      expect(view.button('Add', dialog()!)).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('a link to add a source opens the dialog with its address, read and waiting for a yes', async () => {
    const view = await renderStore({
      listings: LISTINGS,
      target: { addSource: { kind: 'mini-app', input: 'https://bob.test/mini-app-catalog.json' } },
    })
    try {
      expect(field()?.value).toBe('https://bob.test/mini-app-catalog.json')
      expect(view.calls).toEqual(['preview mini-app https://bob.test/mini-app-catalog.json'])
    } finally {
      await view.done()
    }
  })
})
