import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  advanceReveal,
  reconcileReveal,
  revealLengthForMotion,
  seedOnStreamStart,
  shouldAdvanceRevealFrame,
  SMOOTHED_TEXT_FRAME_MS,
} from './useSmoothedText'

describe('advanceReveal (default 220ms catch-up)', () => {
  it('advances at least one char per frame while there is backlog', () => {
    expect(advanceReveal(0, 100, 0.0001)).toBe(1)
    expect(advanceReveal(50, 51, 1)).toBe(51)
  })

  it('drains roughly the backlog over the catch-up window in one big frame', () => {
    expect(advanceReveal(0, 100, 220)).toBe(100)
    expect(advanceReveal(0, 100, 110)).toBe(50)
  })

  it('never overshoots the target', () => {
    expect(advanceReveal(0, 10, 100_000)).toBe(10)
    expect(advanceReveal(95, 100, 100_000)).toBe(100)
  })

  it('respects a custom catch-up window (calmer prose cadence)', () => {
    // A 260ms window reveals less of the backlog per frame than the 220ms default.
    expect(advanceReveal(0, 260, 130, 260)).toBe(130)
    expect(advanceReveal(0, 260, 130, 220)).toBeGreaterThan(130)
  })
})

describe('streaming reveal cadence', () => {
  it('does not schedule React updates faster than the markdown can be reparsed', () => {
    expect(shouldAdvanceRevealFrame(SMOOTHED_TEXT_FRAME_MS - 1)).toBe(false)
    expect(shouldAdvanceRevealFrame(SMOOTHED_TEXT_FRAME_MS)).toBe(true)
  })
})

describe('streaming reveal motion preference', () => {
  it('shows the complete current text instead of pacing it under reduced motion', () => {
    expect(revealLengthForMotion(20, 100, true)).toBe(100)
    expect(revealLengthForMotion(20, 100, false)).toBe(20)
  })
})

describe('reconcileReveal (snap-down on shorter target)', () => {
  it('snaps the revealed length down when the target shrinks', () => {
    expect(reconcileReveal(500, 8)).toBe(8)
  })

  it('leaves the revealed length untouched while the target grows or holds', () => {
    expect(reconcileReveal(50, 500)).toBe(50)
    expect(reconcileReveal(50, 50)).toBe(50)
  })

  it('handles the stream-ended case (target empty → snap to 0)', () => {
    expect(reconcileReveal(500, 0)).toBe(0)
  })
})

describe('seedOnStreamStart (no replay of pre-existing content)', () => {
  // Guards the "old message starts streaming again" glitch: a settled message
  // flipping into streaming (or a remount mid-stream) must NOT typewriter its
  // whole body from 0 — only growth beyond the stream-start prefix animates.
  it('seeds to the full current length when entering streaming with content', () => {
    expect(seedOnStreamStart(0, 500, true)).toBe(500)
  })

  it('is inert while already streaming (ordinary growth keeps animating)', () => {
    expect(seedOnStreamStart(50, 500, false)).toBe(50)
  })

  it('is inert when entering with nothing new to show', () => {
    expect(seedOnStreamStart(0, 0, true)).toBe(0)
    expect(seedOnStreamStart(500, 500, true)).toBe(500)
  })
})

describe('useSmoothedText rAF lifecycle (structural)', () => {
  // Guard the self-stopping loop: an earlier impl scheduled an unconditional rAF in
  // useEffect([], ...), so every settled caller kept a frame loop alive forever. The
  // loop lives inside a hook with no cheap render seam, so these assert the source.
  //
  // They must pin CODE, never prose or formatting. The previous version asserted
  // `toContain('rafRef.current = null; // caught up')` — a COMMENT — so rewording that
  // comment, a zero-behavior-change edit, turned the suite red. A guard that bills you
  // for editing a comment is a tax, not a test. (These were NOT vacuous — deleting the
  // stop block does turn them red — so they are tightened, not replaced.)
  const source = readFileSync(resolve(import.meta.dir, './useSmoothedText.ts'), 'utf8')

  it('keys the reveal effect on the target text, not an empty dep array', () => {
    expect(source).toMatch(/\},\s*\[text, active, catchUpMs, reducedMotion\]\)/)
    expect(source).not.toMatch(/\},\s*\[\]\);?/)
  })

  it('cancels a live pacing loop when reduced motion becomes active', () => {
    expect(source).toMatch(
      /if \(reducedMotion\)\s*\{[\s\S]*?cancelAnimationFrame\(rafRef\.current\)[\s\S]*?setDisplayedLen\(total\)/,
    )
  })

  it('stops the loop once caught up instead of rescheduling forever', () => {
    // Mutation this must catch: deleting the `len >= total` stop block, so the rAF
    // reschedules forever. Matched on the code, not on the trailing comment.
    expect(source).toMatch(/if \(len >= total\)\s*\{\s*rafRef\.current = null;?/)
  })

  it('does not start a loop when already caught up or one is already running', () => {
    expect(source).toMatch(
      /if \(displayedRef\.current >= total \|\| rafRef\.current !== null\)\s*return;?/,
    )
  })

  it('cancels the pending frame on cleanup', () => {
    expect(source).toMatch(/cancelAnimationFrame\(rafRef\.current\)/)
  })
})
