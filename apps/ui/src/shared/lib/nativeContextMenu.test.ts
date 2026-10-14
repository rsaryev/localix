import { describe, expect, it } from 'bun:test'
import { shouldAllowNativeContextMenu } from './nativeContextMenu'

/** Minimal Element stub whose closest() matches a fixed selector set. */
function el(matchesSelectors: string[]): Element {
  return {
    closest(sel: string) {
      // Our predicate passes a comma-list; treat a hit if any of our tags is named.
      return matchesSelectors.some((s) => sel.includes(s)) ? ({} as Element) : null
    },
  } as unknown as Element
}

describe('shouldAllowNativeContextMenu', () => {
  it('allows the native menu when there is a selection (copy)', () => {
    expect(shouldAllowNativeContextMenu(el([]), true)).toBe(true)
    expect(shouldAllowNativeContextMenu(null, true)).toBe(true)
  })

  it('allows the native menu over editable fields', () => {
    expect(shouldAllowNativeContextMenu(el(['input']), false)).toBe(true)
    expect(shouldAllowNativeContextMenu(el(['textarea']), false)).toBe(true)
    expect(shouldAllowNativeContextMenu(el(['contenteditable']), false)).toBe(true)
  })

  it('suppresses the native menu over inert chrome with no selection', () => {
    expect(shouldAllowNativeContextMenu(el([]), false)).toBe(false)
    expect(shouldAllowNativeContextMenu(null, false)).toBe(false)
  })
})
