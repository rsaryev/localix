import { describe, expect, test } from 'bun:test'

import { clamp, cn, CONTROL_FOCUS_VISIBLE, CONTROL_FOCUS_WITHIN } from './classes'

describe('plugin UI class utilities', () => {
  test('merges conditional and conflicting Tailwind classes', () => {
    expect(cn('p-2', false, 'text-muted', 'p-4')).toBe('text-muted p-4')
  })

  test('clamps numbers to an inclusive range', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(4, 0, 10)).toBe(4)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  test('exports one keyboard-focus contract for controls and composite groups', () => {
    // One INSET hairline in `--control-border-focus`, never `--ring` and never `ring-2`: `--ring`
    // is monochrome by design (near-white on dark, near-black on light) and `ring-2` grows OUTSIDE
    // the box, so the pair drew a ~3px collar around every field in the app.
    expect(CONTROL_FOCUS_VISIBLE).toContain('focus-visible:ring-1')
    expect(CONTROL_FOCUS_VISIBLE).toContain('focus-visible:ring-inset')
    expect(CONTROL_FOCUS_VISIBLE).toContain('focus-visible:ring-control-border-focus')
    expect(CONTROL_FOCUS_VISIBLE).not.toContain('ring-2')
    // No border repaint: focus adds an edge, it does not recolour the resting one. Matched with
    // the variant attached, since the ring COLOUR is itself a `--control-border-*` token.
    expect(CONTROL_FOCUS_VISIBLE).not.toContain('focus-visible:border-')

    // `has-[:focus-visible]`, never `focus-within` — the latter fires on mouse clicks too.
    expect(CONTROL_FOCUS_WITHIN).toContain('has-[:focus-visible]:ring-1')
    expect(CONTROL_FOCUS_WITHIN).toContain('has-[:focus-visible]:ring-inset')
    expect(CONTROL_FOCUS_WITHIN).toContain('has-[:focus-visible]:ring-control-border-focus')
    expect(CONTROL_FOCUS_WITHIN).not.toContain('focus-within')
    expect(CONTROL_FOCUS_WITHIN).not.toContain('ring-2')
    expect(CONTROL_FOCUS_WITHIN).not.toContain(']:border-')
  })
})
