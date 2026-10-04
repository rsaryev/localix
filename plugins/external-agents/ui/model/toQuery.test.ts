import { describe, expect, test } from 'bun:test'

import { toQuery } from './useRoster'

/**
 * Every filter the workspace can apply passes through here, and none of them was covered: dropping any
 * one left the whole suite green, because the only caller is a hook that needs React to run.
 *
 * The rule each case pins is the same: an ABSENT filter must be absent from the query, not present and
 * empty. `cwdPrefix: ''` would filter for a directory named nothing, and `providers: []` reads at the
 * route as "these zero providers" rather than "every provider".
 */
const EMPTY = { text: '', providers: [], states: [] }

describe('a roster query carries exactly the filters that were set', () => {
  test('nothing set means nothing sent but the page bounds', () => {
    expect(toQuery(EMPTY, 0, 50)).toEqual({ offset: 0, limit: 50 })
  })

  test('text is trimmed, and whitespace alone is not a filter', () => {
    expect(toQuery({ ...EMPTY, text: '  auth  ' }, 0, 50)).toMatchObject({ text: 'auth' })
    expect('text' in toQuery({ ...EMPTY, text: '   ' }, 0, 50)).toBe(false)
  })

  test('providers and states are sent only when chosen', () => {
    expect(toQuery({ ...EMPTY, providers: ['codex'] }, 0, 50)).toMatchObject({
      providers: ['codex'],
    })
    expect('providers' in toQuery(EMPTY, 0, 50)).toBe(false)
    expect(toQuery({ ...EMPTY, states: ['blocked'] }, 0, 50)).toMatchObject({ states: ['blocked'] })
  })

  test('the project drill is sent as a prefix', () => {
    expect(toQuery({ ...EMPTY, cwdPrefix: '/work/app' }, 0, 50)).toMatchObject({
      cwdPrefix: '/work/app',
    })
    expect('cwdPrefix' in toQuery(EMPTY, 0, 50)).toBe(false)
  })

  test('sub-agent transcripts are asked for only when the toggle is on', () => {
    expect(toQuery({ ...EMPTY, includeChildren: true }, 0, 50)).toMatchObject({
      includeChildren: true,
    })
    // Off must send nothing at all: `includeChildren: false` and its absence mean the same to the
    // route, and sending it invites the next reader to think the two differ.
    expect('includeChildren' in toQuery({ ...EMPTY, includeChildren: false }, 0, 50)).toBe(false)
  })

  test('paging is carried verbatim, since the caller owns it', () => {
    expect(toQuery(EMPTY, 120, 40)).toMatchObject({ offset: 120, limit: 40 })
  })
})

test('a model drill is sent as an exact name, and only when one is chosen', () => {
  // Chosen on the statistics screen and obeyed here, so the bar a reader clicked and the list they
  // land in agree. Absent means absent: `model: ''` would filter for a model named nothing.
  expect(toQuery({ ...EMPTY, model: 'claude-opus-5' }, 0, 50)).toMatchObject({
    model: 'claude-opus-5',
  })
  expect('model' in toQuery(EMPTY, 0, 50)).toBe(false)
})
