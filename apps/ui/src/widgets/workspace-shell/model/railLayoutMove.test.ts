import { expect, test } from 'bun:test'
import {
  moveWithinRailArea,
  resolveRailAreas,
  type RailItemDef,
  type RailLayoutState,
} from './railLayout'

const areas = ['top', 'bar', 'bottom', 'status'] as const
const defs: RailItemDef[] = areas.flatMap((area) =>
  ['a', 'b', 'c'].map((suffix) => ({ id: `${area}-${suffix}`, defaultArea: area })),
)

test.each([...areas])('moving within %s preserves other zones and the previous state', (area) => {
  const state: RailLayoutState = {
    entries: defs.map((def) => ({ id: def.id, area: def.defaultArea })),
  }
  for (const entry of state.entries) Object.freeze(entry)
  Object.freeze(state.entries)
  Object.freeze(state)
  const before = resolveRailAreas(defs, state)
  const moved = moveWithinRailArea(defs, state, `${area}-b`, area, 100)
  expect(moved).not.toBe(state)
  expect(resolveRailAreas(defs, moved)).toEqual({
    ...before,
    [area]: [`${area}-a`, `${area}-c`, `${area}-b`],
  })
  expect(resolveRailAreas(defs, state)).toEqual(before)

  const first = moveWithinRailArea(defs, moved, `${area}-b`, area, -100)
  expect(resolveRailAreas(defs, first)[area]).toEqual([`${area}-b`, `${area}-a`, `${area}-c`])
  const otherArea = areas.find((candidate) => candidate !== area)!
  expect(moveWithinRailArea(defs, state, `${otherArea}-b`, area, 1)).toBe(state)
  expect(moveWithinRailArea(defs, state, 'missing', area, 1)).toBe(state)
})
