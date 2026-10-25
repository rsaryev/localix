import { expect, test } from 'bun:test'

import surface from './AgentsShelf.surface'

test('Agents opens the Store on its Agents shelf, where an agent is made and managed', () => {
  expect(surface).toMatchObject({
    uri: 'localix://ui/work-item/store/agents',
    exposure: { search: true, palette: true },
  })
  expect(surface.resolve({})).toEqual({
    kind: 'work-item',
    workKind: 'store',
    id: 'store',
    title: 'Store',
    payload: { shelf: 'package:agent' },
  })
})
