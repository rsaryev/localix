import { describe, expect, test } from 'bun:test'
import { currentLocation, initialHistory, moveHistory, visit } from './history'

describe('graph navigation history', () => {
  test('revisits selections, levels and lens trails in order', () => {
    const selected = { scope: 'dir:.', selected: 'dir:api', trail: [] }
    const level = { scope: 'dir:api', selected: null, trail: [] }
    const lens = { scope: 'file:api/a.ts', selected: null, trail: ['sym:api/a.ts#run'] }
    const history = visit(visit(visit(initialHistory, selected), level), lens)
    expect(currentLocation(moveHistory(history, -1))).toEqual(level)
    expect(currentLocation(moveHistory(moveHistory(history, -1), -1))).toEqual(selected)
    expect(currentLocation(moveHistory(moveHistory(history, -1), 1))).toEqual(lens)
  })

  test('a new visit after Back replaces the forward branch and ignores a repeated place', () => {
    const first = { scope: 'dir:a', selected: null, trail: [] }
    const second = { scope: 'dir:b', selected: null, trail: [] }
    const alternative = { scope: 'dir:c', selected: null, trail: [] }
    const back = moveHistory(visit(visit(initialHistory, first), second), -1)
    expect(visit(back, first)).toBe(back)
    const branched = visit(back, alternative)
    expect(branched.entries).toEqual([initialHistory.entries[0], first, alternative])
    expect(moveHistory(branched, 1)).toBe(branched)
  })

  test('bounds long sessions while retaining a usable Back path', () => {
    let history = initialHistory
    for (let index = 0; index < 60; index++) {
      history = visit(history, { scope: `dir:${index}`, selected: null, trail: [] })
    }
    expect(history.entries).toHaveLength(50)
    expect(currentLocation(history).scope).toBe('dir:59')
    expect(history.entries[0]?.scope).toBe('dir:10')
  })
})
