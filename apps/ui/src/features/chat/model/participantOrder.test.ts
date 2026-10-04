import { describe, expect, test } from 'bun:test'

import { floorIsRunning, liveParticipantOrder, sameOrder } from './participantOrder'

const ROSTER = ['a', 'b', 'c', 'd', 'e']

describe('liveParticipantOrder', () => {
  test('a fresh strip with no round starts in roster order', () => {
    expect(liveParticipantOrder(ROSTER, null, null)).toEqual(ROSTER)
    expect(liveParticipantOrder(ROSTER, { speaking: null, waiting: [] }, null)).toEqual(ROSTER)
  })

  test('while a round runs the speaker is first, then the waiting by place in line', () => {
    expect(liveParticipantOrder(ROSTER, { speaking: 'd', waiting: ['e', 'b'] }, null)).toEqual([
      'd',
      'e',
      'b',
      'a',
      'c',
    ])
  })

  test('only waiting participants (nobody speaking yet) still lead by place', () => {
    expect(liveParticipantOrder(ROSTER, { speaking: null, waiting: ['c'] }, ROSTER)).toEqual([
      'c',
      'a',
      'b',
      'd',
      'e',
    ])
  })

  test('the rest keep their PREVIOUS relative order, not the roster order', () => {
    const previous = ['e', 'c', 'a', 'd', 'b']
    expect(liveParticipantOrder(ROSTER, { speaking: 'a', waiting: [] }, previous)).toEqual([
      'a',
      'e',
      'c',
      'd',
      'b',
    ])
  })

  test('a new speaker moves to the front and the old one stays where the rest are', () => {
    const first = liveParticipantOrder(ROSTER, { speaking: 'c', waiting: ['e'] }, ROSTER)
    expect(first).toEqual(['c', 'e', 'a', 'b', 'd'])
    expect(liveParticipantOrder(ROSTER, { speaking: 'e', waiting: [] }, first)).toEqual([
      'e',
      'c',
      'a',
      'b',
      'd',
    ])
  })

  test('when the round ends the order is kept, never snapped back to the roster', () => {
    const during = liveParticipantOrder(ROSTER, { speaking: 'd', waiting: [] }, ROSTER)
    expect(liveParticipantOrder(ROSTER, null, during)).toEqual(during)
    expect(liveParticipantOrder(ROSTER, { speaking: null, waiting: [] }, during)).toEqual(during)
  })

  test('joiners append at the end and leavers drop out', () => {
    const previous = ['c', 'a', 'b']
    expect(liveParticipantOrder(['a', 'b', 'x', 'c', 'y'], null, previous)).toEqual([
      'c',
      'a',
      'b',
      'x',
      'y',
    ])
    expect(liveParticipantOrder(['a', 'b'], null, previous)).toEqual(['a', 'b'])
  })

  test('floor ids outside the roster and duplicates are ignored', () => {
    expect(
      liveParticipantOrder(['a', 'b', 'c'], { speaking: 'ghost', waiting: ['b', 'b', 'zz'] }, null),
    ).toEqual(['b', 'a', 'c'])
  })

  test('is idempotent: its own result fed back changes nothing', () => {
    const floor = { speaking: 'b', waiting: ['e', 'a'] }
    const once = liveParticipantOrder(ROSTER, floor, ['d', 'c', 'b', 'a', 'e'])
    expect(liveParticipantOrder(ROSTER, floor, once)).toEqual(once)
  })
})

describe('helpers', () => {
  test('floorIsRunning', () => {
    expect(floorIsRunning(null)).toBe(false)
    expect(floorIsRunning({ speaking: null, waiting: [] })).toBe(false)
    expect(floorIsRunning({ speaking: 'a', waiting: [] })).toBe(true)
    expect(floorIsRunning({ speaking: null, waiting: ['a'] })).toBe(true)
  })

  test('sameOrder compares sequences', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false)
  })
})
