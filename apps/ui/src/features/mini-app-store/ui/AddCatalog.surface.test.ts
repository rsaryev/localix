import { expect, test } from 'bun:test'

import surface from './AddCatalog.surface'

test('a link to add a catalog opens the store with the address, and adds nothing itself', () => {
  expect(surface).toMatchObject({
    uri: 'localix://ui/work-item/mini-app-store/add-catalog',
    effect: 'read',
    params: { url: { type: 'string' } },
  })
  expect(surface.resolve({ url: 'https://ada.test/mini-app-catalog.json' })).toEqual({
    kind: 'work-item',
    workKind: 'mini-app-store',
    id: 'mini-app-store',
    title: 'Mini apps',
    payload: { addCatalog: 'https://ada.test/mini-app-catalog.json' },
  })
  expect(surface.present?.({ url: 'https://ada.test/mini-app-catalog.json' })).toEqual({
    label: 'Add the catalog at ada.test',
    description: 'Opens the store to read it first; nothing is added until you choose Add',
  })
})
