import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CreateForm } from '@localixai/store'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const FORM: CreateForm = {
  noun: 'chess set',
  scopes: ['user', 'project'],
  fields: [
    { key: 'name', label: 'Name', type: 'string', required: true, secret: false },
    { key: 'note', label: 'Note', type: 'string', required: false, secret: false },
  ],
}
const CHESS = listing({ id: 'chess', displayName: 'Chess' })

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const field = (label: string) => {
  const found = [...dialog()!.querySelectorAll('label')].find((node) =>
    node.textContent?.startsWith(label),
  )
  return found ? dialog()!.querySelector<HTMLInputElement>(`#${CSS.escape(found.htmlFor)}`) : null
}

/** The select a person reaches by its visible label: the combobox the label names. */
const picker = (within: ParentNode, label: string) =>
  [...within.querySelectorAll<HTMLElement>('[role="combobox"]')].find((node) =>
    document
      .getElementById(node.getAttribute('aria-labelledby') ?? '')
      ?.textContent?.startsWith(label),
  ) ?? null

describe('making a new item in the Store', () => {
  test('a kind that can make its own shows Add on its shelf, even while the shelf is empty', async () => {
    const view = await renderStore({
      listings: [listing({ id: 'plain', ref: { kind: 'plugin', id: 'plain' } })],
      creates: { 'mini-app': FORM },
    })
    try {
      await view.click(view.shelf('Mini apps'))
      expect(view.button('Add chess set')).toBeDefined()
    } finally {
      await view.done()
    }
  })

  test('no Add where no provider can make one', async () => {
    const view = await renderStore({ listings: [CHESS] })
    try {
      await view.click(view.shelf('Mini apps'))
      expect(view.button('Add chess set')).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('the dialog asks the form’s fields, needs the required ones, then creates and opens it', async () => {
    const view = await renderStore({ listings: [CHESS], creates: { 'mini-app': FORM } })
    try {
      await view.click(view.shelf('Mini apps'))
      await view.click(view.button('Add chess set'))
      expect(dialog()?.textContent).toContain('Add chess set')
      await view.click(view.button('Add', dialog()!))
      expect(view.calls).toEqual([])
      expect(dialog()?.textContent).toContain('Name is required')
      await view.type(field('Name'), 'chess')
      await view.click(view.button('Add', dialog()!))
      expect(view.calls).toEqual(['create mini-app user {"name":"chess"}'])
      expect(dialog()).toBeNull()
      expect(view.host.querySelector('[data-store-page]')?.textContent).toContain('Chess')
    } finally {
      await view.done()
    }
  })

  test('with a project open, the dialog says where it is kept and can keep it there', async () => {
    const view = await renderStore({
      listings: [CHESS],
      project: { id: 'p1', name: 'Atlas' },
      creates: { 'mini-app': FORM },
    })
    try {
      await view.click(view.shelf('Mini apps'))
      await view.click(view.button('Add chess set'))
      await view.openMenu(picker(dialog()!, 'Keep it for')!)
      const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (node) => node.textContent?.includes('Atlas'),
      )
      await view.click(option)
      await view.type(field('Name'), 'chess')
      await view.click(view.button('Add', dialog()!))
      expect(view.calls).toEqual(['create mini-app project in p1 {"name":"chess"}'])
    } finally {
      await view.done()
    }
  })

  test('a provider’s refusal is said in the dialog and the dialog stays', async () => {
    const view = await renderStore({
      listings: [CHESS],
      creates: { 'mini-app': FORM },
      createFails: 'A chess set named chess exists',
    })
    try {
      await view.click(view.shelf('Mini apps'))
      await view.click(view.button('Add chess set'))
      await view.type(field('Name'), 'chess')
      await view.click(view.button('Add', dialog()!))
      expect(dialog()?.textContent).toContain('A chess set named chess exists')
    } finally {
      await view.done()
    }
  })
})
