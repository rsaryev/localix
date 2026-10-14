import { describe, expect, test } from 'bun:test'
import {
  mergeMatricesByText,
  renderCapabilityMatrix,
  renderGoldenMatrix,
  renderLintMatrix,
} from './testing/prompt-harness'

/**
 * The union the prompt lints run over. Three of them (`system-prompt-dedup`,
 * `system-prompt-capability`, `system-prompt-tool-defaults`) each built it themselves as
 * `{ ...renderCapabilityMatrix(), ...renderGoldenMatrix() }`, which dedupes by KEY. The
 * goldens are hand-written labels shaped exactly like the derived variant keys, so ten
 * generated cells collided: 49 entries linted as 39, and where a colliding pair
 * DIFFERED the golden silently won — in the very mechanism built because the goldens "kept
 * missing capability bugs".
 *
 * These pin the two halves of the replacement. Test 2 is the one that fails if anyone
 * reintroduces a key-based merge.
 */
describe('renderLintMatrix', () => {
  const union = renderLintMatrix()

  test('holds no two entries with the same prompt text', () => {
    const texts = Object.values(union)
    expect(new Set(texts).size).toBe(texts.length)
  })

  test('loses no distinct prompt to a name collision', () => {
    const everyText = [
      ...Object.values(renderGoldenMatrix()),
      ...Object.values(renderCapabilityMatrix()),
    ]
    // Deduping on text is allowed; dropping a text is not.
    expect(Object.keys(union).length).toBe(new Set(everyText).size)
  })

  test('keeps BOTH sides when two sources share a name but not a prompt', () => {
    // The merge rule itself, pinned on a constructed pair rather than on whichever live
    // variant happens to collide this month: a shared name with DIFFERENT text must qualify
    // the later entry, never drop it. (Identical text still collapses — that is the point of
    // deduping on text: it is the same prompt however it was reached.)
    const merged = mergeMatricesByText({ a: 'ONE', b: 'SHARED' }, { a: 'TWO', c: 'SHARED' })
    expect(merged.a).toBe('ONE')
    expect(merged['a (2)']).toBe('TWO')
    expect(merged.b).toBe('SHARED')
    expect(Object.keys(merged)).not.toContain('c')
  })

  test('gives every golden its unqualified, human-reviewed name', () => {
    // Goldens are visited first, so a generated twin is the one that gets qualified.
    for (const name of Object.keys(renderGoldenMatrix())) {
      expect(Object.keys(union)).toContain(name)
    }
  })
})
