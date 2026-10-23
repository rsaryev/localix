import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MODAL_ENTER_EXIT } from './overlay-motion'

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

  test('the modal entrance recipe has its motion rules, with a reduced-motion escape', () => {
    const motion = readFileSync(resolve(import.meta.dir, '../../styles/motion.css'), 'utf8')
    expect(motion).toContain(`.${MODAL_ENTER_EXIT}[data-state='open']`)
    expect(motion).toContain(`.${MODAL_ENTER_EXIT}[data-state='closed']`)
    expect(motion).toContain('prefers-reduced-motion')
  })
})
