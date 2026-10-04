/**
 * Every filter this workspace declares has to reach the server, and has to refetch when it changes.
 *
 * It did not. The effect that fetches the first page rebuilt its query from `text`, `providers` and
 * `states` — the three fields the hook happened to destructure — so `cwdPrefix`, `includeChildren`
 * and `model` were dropped on the way out, and none of them was in the dependency array either. The
 * sub-agent toggle and both statistics drills narrowed nothing at all. Each had been verified end to
 * end: the fold over real sessions, the route's schema, and `toQuery` in isolation. The one seam
 * nobody looked at was the caller, and TypeScript could not see it because every dropped field is
 * optional, so the three-field object literal type-checked as a whole `RosterFilters`.
 *
 * Two guards, because the failure had two halves:
 *  - `filterKeyOf` decides whether a change REFETCHES;
 *  - `toQuery` decides what is SENT.
 *
 * Both are pinned against the interface by reading the source, following
 * `discovery/cache-shape.test.ts` — a field added to `RosterFilters` and forgotten in either place
 * is the exact bug this file exists for, and it produces no error, no warning and no failing test.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { filterKeyOf } from './useRoster'
import type { RosterFilters } from './useRoster'

const SOURCE = readFileSync(join(import.meta.dir, 'useRoster.ts'), 'utf8')

/** The field names declared on `RosterFilters`, read from the declaration itself. */
function declaredFields(): string[] {
  const block = /export interface RosterFilters \{([\s\S]*?)\n\}/.exec(SOURCE)?.[1] ?? ''
  return [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1] as string)
}

/** The body of a top-level function, so a name can be looked for inside the right one. */
function bodyOf(name: string): string {
  const at = SOURCE.indexOf(`export function ${name}(`)
  const end = SOURCE.indexOf('\n}', at)
  return at < 0 ? '' : SOURCE.slice(at, end)
}

const BASE: RosterFilters = { text: '', providers: [], states: [] }

describe('the declaration and the two functions that consume it agree', () => {
  test('the interface is readable at all — seven fields, not zero', () => {
    // If this drifts to an empty list the two tests below pass vacuously.
    expect(declaredFields()).toEqual([
      'text',
      'providers',
      'states',
      'cwdPrefix',
      'includeChildren',
      'model',
      'parentKey',
    ])
  })

  test('every declared filter takes part in the refetch key', () => {
    const body = bodyOf('filterKeyOf')

    for (const field of declaredFields()) expect(body).toContain(`filters.${field}`)
  })

  test('every declared filter takes part in the query that is sent', () => {
    const body = bodyOf('toQuery')

    for (const field of declaredFields()) expect(body).toContain(`filters.${field}`)
  })
})

describe('a change to any one filter is a different fetch', () => {
  const cases: [string, RosterFilters][] = [
    ['text', { ...BASE, text: 'auth' }],
    ['providers', { ...BASE, providers: ['codex'] }],
    ['states', { ...BASE, states: ['working'] }],
    ['cwdPrefix', { ...BASE, cwdPrefix: '/work/app' }],
    ['includeChildren', { ...BASE, includeChildren: true }],
    ['model', { ...BASE, model: 'claude-opus-5' }],
    ['parentKey', { ...BASE, parentKey: 'claude-code:p1' }],
  ]

  for (const [name, filters] of cases) {
    test(`${name} moves the key`, () => {
      expect(filterKeyOf(filters)).not.toBe(filterKeyOf(BASE))
    })
  }

  test('the same set is the same key, so a poll tick is a refresh and not a restart', () => {
    // The distinction the hook draws from this key: a refresh keeps the reader's paging depth, a
    // filter change starts over at one page.
    expect(filterKeyOf({ ...BASE, providers: ['codex'], model: 'gpt-5.4' })).toBe(
      filterKeyOf({ ...BASE, providers: ['codex'], model: 'gpt-5.4' }),
    )
  })

  test('an absent filter and its empty form are the same fetch', () => {
    // `cwdPrefix: ''` is not a filter for a directory named nothing — `toQuery` drops it, so the key
    // must not claim a change either, or every keystroke that clears a field would restart paging.
    expect(filterKeyOf({ ...BASE, cwdPrefix: '', model: '' })).toBe(filterKeyOf(BASE))
  })
})
