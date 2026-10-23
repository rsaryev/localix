import { expect, test } from 'bun:test'
import {
  emptyReaderNavigationTrail,
  moveReaderNavigation,
  pushReaderNavigation,
  type ReaderNavigationTrail,
} from './model'

test('an equivalent normalized location retains both history branches and the same trail', () => {
  const trail: ReaderNavigationTrail = {
    past: [{ chapter: 1, fraction: 0.5 }],
    future: [{ chapter: 3, fraction: 0.2 }],
  }
  expect(
    pushReaderNavigation(
      trail,
      { chapter: 2.8, fraction: 0.4, fragment: ' target ' },
      { chapter: 2, fraction: 0.4005, fragment: 'target' },
    ),
  ).toBe(trail)
})

test('a new navigation branch bounds the past and discards only the returned future', () => {
  const trail: ReaderNavigationTrail = {
    past: [
      { chapter: 1, fraction: 0 },
      { chapter: 2, fraction: 0 },
    ],
    future: [{ chapter: 4, fraction: 0 }],
  }
  Object.freeze(trail.past)
  Object.freeze(trail.future)
  Object.freeze(trail)
  const branched = pushReaderNavigation(
    trail,
    { chapter: 3.7, fraction: 2, fragment: ' end ' },
    { chapter: 8, fraction: 0 },
    2,
  )
  expect(branched).toEqual({
    past: [
      { chapter: 2, fraction: 0 },
      { chapter: 3, fraction: 1, fragment: 'end' },
    ],
    future: [],
  })
  expect(branched.past[0]).toBe(trail.past[1])
  expect(trail.future).toEqual([{ chapter: 4, fraction: 0 }])
  const back = moveReaderNavigation(branched, { chapter: 8, fraction: 0 }, 'back')
  expect(back.location).toBe(branched.past[1])
})

test('empty back and forward history preserve the trail reference', () => {
  const trail = emptyReaderNavigationTrail()
  for (const direction of ['back', 'forward'] as const) {
    const result = moveReaderNavigation(trail, { chapter: 0, fraction: 0 }, direction)
    expect(result.trail).toBe(trail)
    expect(result.location).toBeNull()
  }
})
