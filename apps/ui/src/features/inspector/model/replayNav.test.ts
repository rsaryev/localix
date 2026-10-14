import { describe, expect, it } from 'bun:test'
import { computeReplayNav } from './replayNav'

const ids = ['a', 'b', 'c']

describe('computeReplayNav', () => {
  it('reports 1-based position and total', () => {
    expect(computeReplayNav(ids, 'a')).toMatchObject({ position: 1, total: 3 })
    expect(computeReplayNav(ids, 'b')).toMatchObject({ position: 2, total: 3 })
    expect(computeReplayNav(ids, 'c')).toMatchObject({ position: 3, total: 3 })
  })

  it('has no prev at the start and no next at the end', () => {
    expect(computeReplayNav(ids, 'a')).toMatchObject({ prevId: null, nextId: 'b' })
    expect(computeReplayNav(ids, 'c')).toMatchObject({ prevId: 'b', nextId: null })
  })

  it('exposes both neighbours in the middle', () => {
    expect(computeReplayNav(ids, 'b')).toMatchObject({ prevId: 'a', nextId: 'c' })
  })

  it('is empty when the focused id is absent or null', () => {
    expect(computeReplayNav(ids, 'z')).toEqual({
      position: 0,
      total: 3,
      prevId: null,
      nextId: null,
    })
    expect(computeReplayNav(ids, null)).toEqual({
      position: 0,
      total: 3,
      prevId: null,
      nextId: null,
    })
  })

  it('handles an empty list', () => {
    expect(computeReplayNav([], 'a')).toEqual({ position: 0, total: 0, prevId: null, nextId: null })
  })

  it('handles a single-message list', () => {
    expect(computeReplayNav(['only'], 'only')).toEqual({
      position: 1,
      total: 1,
      prevId: null,
      nextId: null,
    })
  })
})
