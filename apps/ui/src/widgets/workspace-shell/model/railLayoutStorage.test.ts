import { expect, test } from 'bun:test'
import { parseRailLayout, resolveRailAreas, serializeRailLayout } from './railLayout'

test('recovered entries retain the first placement and resolve against the current catalog', () => {
  const recovered = parseRailLayout(
    JSON.stringify({
      v: 6,
      entries: [
        null,
        { id: '', area: 'top' },
        { id: 7, area: 'bar' },
        { id: 'panel', area: 'unknown' },
        { id: 'panel', area: 'overflow' },
        { id: 'removed', area: 'top' },
      ],
    }),
  )
  expect(recovered).toEqual({
    entries: [
      { id: 'panel', area: 'bar' },
      { id: 'removed', area: 'top' },
    ],
  })
  expect(parseRailLayout(serializeRailLayout(recovered!))).toEqual(recovered)
  expect(
    resolveRailAreas(
      [
        { id: 'panel', defaultArea: 'bottom', placeable: false },
        { id: 'new-panel', defaultArea: 'top' },
      ],
      recovered,
    ),
  ).toEqual({
    top: ['new-panel'],
    bar: [],
    bottom: [],
    status: [],
    overflow: ['panel'],
  })
})
