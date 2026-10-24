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

test('a Store search hit opens the Store on that listing’s page', () => {
  expect(surface.resolve({ kind: 'plugin', id: 'lint@claude-plugins-official' })).toEqual({
    kind: 'work-item',
    workKind: 'store',
    id: 'store',
    title: 'Store',
    payload: { ref: { kind: 'plugin', id: 'lint@claude-plugins-official' } },
  })
})
