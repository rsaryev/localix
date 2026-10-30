import { expect, test } from 'bun:test'

import surface from './AddMarketplace.surface'

test('a link to add a marketplace opens the store with its address, and adds nothing itself', () => {
  expect(surface).toMatchObject({
    uri: 'localix://ui/work-item/mini-app-store/add-marketplace',
    effect: 'read',
    params: { url: { type: 'string' } },
  })
  expect(surface.resolve({ url: 'ada/apps' })).toEqual({
    kind: 'work-item',
    workKind: 'store',
    id: 'store',
    title: 'Store',
    payload: { shelf: 'sources', addSource: { kind: 'mini-app', input: 'ada/apps' } },
  })
  expect(surface.present?.({ url: 'ada/apps' })).toEqual({
    label: 'Add the marketplace ada/apps',
    description: 'Opens the Store to read it first; nothing is added until you choose Add',
  })
  expect(surface.present?.({ url: 'https://ada.test/m/mini-app-marketplace.json' })?.label).toBe(
    'Add the marketplace at ada.test',
  )
})
