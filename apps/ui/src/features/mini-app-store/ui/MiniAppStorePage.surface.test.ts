import { expect, test } from 'bun:test'

import surface from './MiniAppStorePage.surface'

test('the store opens from search and the command palette, in its one app-level tab', () => {
  expect(surface).toMatchObject({
    uri: 'localix://ui/work-item/mini-app-store',
    exposure: { search: true, palette: true },
  })
  expect(surface.resolve({})).toEqual({
    kind: 'work-item',
    workKind: 'mini-app-store',
    id: 'mini-app-store',
    title: 'Mini apps',
  })
})
