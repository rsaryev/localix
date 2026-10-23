import { expect, test } from 'bun:test'

import { centre, glidePoints } from './useGlide'

const SIZE = 16

test('every segment eases from where it was drawn to its new cell', () => {
  const from = [centre(34, SIZE), centre(33, SIZE), centre(32, SIZE)]
  const halfway = glidePoints(from, [35, 34, 33], 0.5, SIZE)
  expect(halfway[0]).toEqual({ x: 3, y: 2.5 })
  expect(halfway[2]).toEqual({ x: 1, y: 2.5 })
  expect(glidePoints(from, [35, 34, 33], 1, SIZE)).toEqual([
    centre(35, SIZE),
    centre(34, SIZE),
    centre(33, SIZE),
  ])
})

test('a segment the snake grew this step starts at the old tail, so the tail stays put', () => {
  const from = [centre(34, SIZE), centre(33, SIZE)]
  const grown = glidePoints(from, [35, 34, 33], 0, SIZE)
  expect(grown[2]).toEqual(centre(33, SIZE))
})
