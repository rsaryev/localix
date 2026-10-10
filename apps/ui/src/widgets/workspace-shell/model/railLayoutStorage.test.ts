import { expect, test } from 'bun:test'
import { parseRailLayout, resolveRailAreas, serializeRailLayout } from './railLayout'

test('recovered entries retain the first placement and resolve against the current catalog', () => {
  const recovered = parseRailLayout(
    JSON.stringify({
      v: 4,
      entries: [
        null,
        { id: '', area: 'top' },
        { id: 7, area: 'bar' },
        { id: 'panel', area: 'unknown' },
        { id: 'panel', area: 'overflow' },
        { id: 'utility:reset', area: 'bottom' },
        { id: 'removed', area: 'top' },
      ],
    }),
  )
  expect(recovered).toEqual({
    entries: [
      { id: 'panel', area: 'bar' },
      { id: 'utility:reset', area: 'status' },
      { id: 'removed', area: 'top' },
    ],
  })
  expect(parseRailLayout(serializeRailLayout(recovered!))).toEqual(recovered)
  expect(
    resolveRailAreas(
      [
        { id: 'panel', defaultArea: 'bottom', placeable: false },
        { id: 'utility:reset', defaultArea: 'bar' },
        { id: 'new-panel', defaultArea: 'top' },
      ],
      recovered,
    ),
  ).toEqual({
    top: ['new-panel'],
    bar: [],
    bottom: [],
    status: ['utility:reset'],
    overflow: ['panel'],
  })
})
