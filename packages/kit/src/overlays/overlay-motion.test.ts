import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  OVERLAY_ENTER_EXIT,
  OVERLAY_NO_MOTION,
  OVERLAY_SLIDE,
  SCRIM_ENTER_EXIT,
  TOOLTIP_ENTER_EXIT,
} from './overlay-motion'

const read = (file: string) => readFileSync(resolve(import.meta.dir, file), 'utf8')

/** Every primitive that portals an overlay, and the recipe each must take its motion from. */
const OVERLAY_PRIMITIVES = [
  'popover.tsx',
  'dropdown-menu.tsx',
  'context-menu.tsx',
  'hover-card.tsx',
  'tooltip.tsx',
  'dialog.tsx',
  'confirm-dialog.tsx',
] as const

/** A transcribed entrance: an animation utility or a literal duration written in the primitive. */
const TRANSCRIBED_MOTION =
  /\b(?:data-\[state=(?:open|closed)\]:(?:animate|fade|zoom)|data-(?:open|closed):animate|duration-\d+)/u

describe('overlay motion', () => {
  test('every overlay primitive takes its motion from the one recipe module', () => {
    for (const file of OVERLAY_PRIMITIVES) {
      const source = read(file)
      expect({ file, imports: source.includes("from './overlay-motion'") }).toEqual({
        file,
        imports: true,
      })
      expect({ file, transcribed: TRANSCRIBED_MOTION.exec(source)?.[0] ?? null }).toEqual({
        file,
        transcribed: null,
      })
    }
  })

  test('the detector catches both transcribed spellings (positive control)', () => {
    expect(TRANSCRIBED_MOTION.test("'duration-100 data-open:animate-in'")).toBe(true)
    expect(TRANSCRIBED_MOTION.test("'data-[state=open]:fade-in-0'")).toBe(true)
    expect(TRANSCRIBED_MOTION.test("'duration-(--dur-instant)'")).toBe(false)
  })

  test('recipes are timed by the motion token, not a literal', () => {
    for (const recipe of [OVERLAY_ENTER_EXIT, SCRIM_ENTER_EXIT, TOOLTIP_ENTER_EXIT]) {
      expect(recipe).toContain('duration-(--dur-instant)')
    }
    // The tooltip cannot use the `data-open:` gate — its open state is `delayed-open`.
    expect(TOOLTIP_ENTER_EXIT).not.toContain('data-open:')
    expect(OVERLAY_SLIDE.near).toContain('slide-in-from-top-1')
    expect(OVERLAY_SLIDE.far).toContain('slide-in-from-top-2')
  })

  test('media backdrops retain their explicit open and closed animation opt-out', () => {
    expect(OVERLAY_NO_MOTION).toBe('data-open:animate-none data-closed:animate-none')
    expect(read('dialog.tsx')).toContain("appearance === 'media' ? OVERLAY_NO_MOTION : undefined")
  })
})
