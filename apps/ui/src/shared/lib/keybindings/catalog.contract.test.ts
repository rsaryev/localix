import { describe, expect, test } from 'bun:test'

import { SHORTCUT_CATALOG } from './catalog'
import { findConflicts, resolveBindings } from './resolve'

/**
 * The shipped defaults must not collide with themselves.
 *
 * `findConflicts` exists and is wired into the keyboard settings screen, where it
 * warns a user who rebinds a key onto one already taken. Nothing applied it to the
 * catalog we SHIP: the only assertion over the defaults checked a single command id
 * (`chord.test.ts` — "not a conflict, different categories"), so a new default that
 * collided with an existing one inside the same category would pass every test and
 * reach users, where one of the two shortcuts silently never fires.
 *
 * That is the whole shape of this defect class — a guard that exists, and is simply
 * not run at the point where it would catch something.
 */

describe('shipped keybinding defaults', () => {
  test('no command shadows another in the same category', () => {
    const conflicting = [...findConflicts(resolveBindings(undefined))].sort()

    expect(
      conflicting,
      'two default shortcuts share a chord in one category — the loser never fires',
    ).toEqual([])
  })

  test('every catalog command id is unique', () => {
    // A duplicate id makes the later entry win the resolve map and the earlier one
    // unreachable — including from the settings screen, so it cannot even be rebound.
    const ids = SHORTCUT_CATALOG.map((command) => command.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  test('the checks are not vacuous', () => {
    // Both assertions above are satisfied by an empty catalog.
    expect(SHORTCUT_CATALOG.length).toBeGreaterThan(30)
    expect(Object.keys(resolveBindings(undefined)).length).toBeGreaterThan(30)
  })
})
