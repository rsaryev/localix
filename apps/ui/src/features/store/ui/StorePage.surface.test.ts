import { expect, test } from 'bun:test'

import surface from './StorePage.surface'

test('the Store opens from search and the command palette, in its one app-level tab', () => {
  expect(surface).toMatchObject({
    uri: 'localix://ui/work-item/store',
    exposure: { search: true, palette: true },
  })
  expect(surface.resolve({})).toEqual({
    kind: 'work-item',
    workKind: 'store',
    id: 'store',
    title: 'Store',
    payload: {},
  })
})
