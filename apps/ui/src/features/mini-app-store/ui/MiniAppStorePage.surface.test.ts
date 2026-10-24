import { expect, test } from 'bun:test'

import surface from './MiniAppStorePage.surface'

test('the mini app store opens the Store on its Mini apps shelf, from search and the palette', () => {
  expect(surface).toMatchObject({
    uri: 'localix://ui/work-item/mini-app-store',
    exposure: { search: true, palette: true },
  })
  expect(surface.resolve({})).toEqual({
    kind: 'work-item',
    workKind: 'store',
    id: 'store',
    title: 'Store',
    payload: { shelf: 'package:mini-app' },
  })
})
