import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The slot moved out of the card when the card also grew a context menu; the rules below are
// about the slot, so they follow it.
const row = readFileSync(resolve(import.meta.dir, 'MessageActionsRow.tsx'), 'utf8')
const wrapper = row.match(/className="lx-hover-actions[^"]*"/)?.[0] ?? ''

/**
 * A transcript is text. Six controls under every card compete with it, so they stay quiet
 * until asked for — but "quiet" must not mean "unreachable", and each rule below is one way
 * that goes wrong. Source text, because these are about which class a list names.
 */
describe('message actions reveal', () => {
  test('a pointer that cannot hover keeps them', () => {
    // `.lx-hover-actions` is the shared class index.css already forces visible under
    // `(hover: none), (pointer: coarse)`. Hiding them behind a hover any other way makes
    // them unreachable on a touch device, silently.
    expect(wrapper).toContain('lx-hover-actions')
  })

  test('a keyboard reaches them', () => {
    // Focus moving into the card reveals them; without this, tabbing lands on a control
    // nobody can see.
    expect(wrapper).toContain('group-focus-within:opacity-100')
    expect(wrapper).toContain('group-hover:opacity-100')
  })

  test('an open overflow menu keeps them', () => {
    // The menu portals out of this subtree, so focus-within alone drops the strip the
    // moment the menu takes focus — the actions vanish from under an open menu.
    expect(wrapper).toContain('has-[[data-state=open]]:opacity-100')
  })

  test('nothing moves: the strip stays in flow and only its opacity changes', () => {
    // index.css records the version that was REMOVED: two absolutely-positioned layers with
    // fixed heights, which is what forced touch devices to re-flow the row. A reveal that
    // changes layout also makes the transcript jump under the cursor.
    expect(wrapper).not.toMatch(/\babsolute\b/)
    expect(wrapper).toContain('opacity-0')
    expect(wrapper).toContain('transition-opacity')
  })
})
