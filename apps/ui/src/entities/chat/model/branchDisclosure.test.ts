import { describe, expect, test } from 'bun:test'
import { BRANCH_PREVIEW, branchView, toggleBranch } from './branchDisclosure'

const items = Array.from({ length: 8 }, (_, index) => index)

describe('branchView', () => {
  test('a branch nobody has touched is OPEN', () => {
    // Collapsed rather than expanded state, so the absent value is the default we want. The
    // list must show the chats the user came for without them opening anything.
    expect(branchView(items).open).toBe(true)
  })

  test('the preview holds the rest back, and says how many', () => {
    const view = branchView(items)
    expect(view.shown).toHaveLength(BRANCH_PREVIEW)
    expect(view.hidden).toBe(items.length - BRANCH_PREVIEW)
  })

  test('a short branch holds nothing back', () => {
    expect(branchView([1, 2]).hidden).toBe(0)
    expect(branchView([]).hidden).toBe(0)
  })

  test('collapsed and show-all are independent', () => {
    // One flag for two questions would make "show me the rest of this branch" also re-open
    // every branch the user had deliberately shut.
    expect(branchView(items, { collapsed: true }).open).toBe(false)
    expect(branchView(items, { showAll: true }).shown).toHaveLength(8)
    const both = branchView(items, { collapsed: true, showAll: true })
    expect(both.open).toBe(false)
    expect(both.shown).toHaveLength(8)
  })

  test('a search opens everything and holds nothing back', () => {
    // A match deeper in the tree has to be reachable.
    const view = branchView(items, { collapsed: true }, true)
    expect(view.open).toBe(true)
    expect(view.hidden).toBe(0)
  })

  test('a search does not change what the user set', () => {
    // Forcing is a view, not a state change: closing the search leaves the branch as it was.
    const state = { collapsed: true }
    branchView(items, state, true)
    expect(branchView(items, state).open).toBe(false)
  })
})

describe('toggleBranch', () => {
  test('flips one key and leaves the others alone', () => {
    expect(toggleBranch({ a: true }, 'b')).toEqual({ a: true, b: true })
    expect(toggleBranch({ a: true }, 'a')).toEqual({ a: false })
  })

  test('reads the flag from the map, so a caller cannot hand it the opposite', () => {
    // The earlier signature took "the current value" too, and a call site passed the DERIVED
    // `open` — the negation of the stored `collapsed` — so every toggle wrote back the value
    // already there and the group would not close.
    const collapsed = toggleBranch({}, 'qa')
    expect(collapsed.qa).toBe(true)
    expect(toggleBranch(collapsed, 'qa').qa).toBe(false)
  })
})
