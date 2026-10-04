import { describe, expect, test } from 'bun:test'

import { statsRequest } from './useStats'

/**
 * A mutation sweep found every filter in this hook droppable with the whole suite green — its only
 * caller needed React to run. The two failures it invited are opposite and both silent: a filter missing
 * from the PAYLOAD shows unfiltered figures while the chips look active, and a filter missing from the
 * KEY means changing it never refetches and the screen quietly goes stale.
 *
 * They cannot diverge now, because the key is derived from the query. These cases pin that.
 */
describe('a stats request carries the filters that were set', () => {
  test('nothing chosen sends only the range', () => {
    expect(statsRequest([], 30, undefined, undefined, false, 0).query).toEqual({ days: 30 })
  })

  test('providers and a project drill are sent when chosen, and absent when not', () => {
    expect(statsRequest(['codex'], 30, '/work/app', undefined, false, 0).query).toEqual({
      days: 30,
      providers: ['codex'],
      cwdPrefix: '/work/app',
    })
    // Absent, never present-and-empty: `providers: []` reads at the route as "these zero providers".
    expect('providers' in statsRequest([], 30, undefined, undefined, false, 0).query).toBe(false)
    expect('cwdPrefix' in statsRequest([], 30, '', undefined, false, 0).query).toBe(false)
  })

  test('every field that changes the answer also changes the key', () => {
    const base = statsRequest(['codex'], 30, '/work/app', undefined, false, 0).key
    expect(statsRequest(['hermes'], 30, '/work/app', undefined, false, 0).key).not.toBe(base)
    expect(statsRequest(['codex'], 90, '/work/app', undefined, false, 0).key).not.toBe(base)
    expect(statsRequest(['codex'], 30, '/work/other', undefined, false, 0).key).not.toBe(base)
    // A manual reload must re-issue an otherwise identical request.
    expect(statsRequest(['codex'], 30, '/work/app', undefined, false, 1).key).not.toBe(base)
  })

  test('an unchanged request keeps its key, so returning to the view is free', () => {
    expect(statsRequest(['codex'], 30, '/work/app', undefined, false, 0).key).toBe(
      statsRequest(['codex'], 30, '/work/app', undefined, false, 0).key,
    )
  })

  test('the key is derived from the query, so a new filter cannot be forgotten in it', () => {
    const { query, key } = statsRequest(['codex'], 30, '/work/app', undefined, false, 0)
    for (const field of Object.keys(query)) expect(key).toContain(field)
  })
})

describe('the model drill travels with the rest of the query', () => {
  test('it is sent when chosen and omitted when not', () => {
    expect(statsRequest([], 30, undefined, 'claude-opus-5', false, 0).query).toMatchObject({
      model: 'claude-opus-5',
    })
    expect('model' in statsRequest([], 30, undefined, undefined, false, 0).query).toBe(false)
  })

  test('changing only the model changes the cache key, so the answer is refetched', () => {
    const base = statsRequest([], 30, undefined, 'claude-opus-5', false, 0).key

    expect(statsRequest([], 30, undefined, 'gpt-5.4', false, 0).key).not.toBe(base)
  })
})

describe('the sub-agent toggle reaches the statistics too', () => {
  test('it is sent when on and omitted when off', () => {
    // Measured on a real local history: including them takes 252 sessions to 1,535 and 19.1T tokens to
    // 42.4T — 55% of everything measured. The list obeyed the toggle while every figure beside it
    // answered for the other 45%.
    expect(statsRequest([], 30, undefined, undefined, true, 0).query).toMatchObject({
      includeChildren: true,
    })
    expect('includeChildren' in statsRequest([], 30, undefined, undefined, false, 0).query).toBe(
      false,
    )
  })

  test('toggling it refetches, rather than leaving the old totals on screen', () => {
    expect(statsRequest([], 30, undefined, undefined, true, 0).key).not.toBe(
      statsRequest([], 30, undefined, undefined, false, 0).key,
    )
  })
})
