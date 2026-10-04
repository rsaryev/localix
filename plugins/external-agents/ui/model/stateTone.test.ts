import { describe, expect, it, test } from 'bun:test'

import { STATE_LABEL, stateDotClass, stateGlyphLabel, AUTHORITY_LABEL } from './stateTone'
import { STATE_AUTHORITIES } from '../../shared/state'

/**
 * The roster's dot is the only thing most readers look at, so what it can and cannot claim matters.
 *
 * `authority` does not separate a matched rule from the manifest's no-match fallback — both are
 * `screen-manifest` — and claude-code's manifest yields no `working` state at all, so a busy Claude
 * Code agent is drawn from the fallback every tick. Painting it in the same confident tone as an
 * observed idle is the failure these two assertions exist to prevent.
 */
describe('an unconfirmed state is not drawn as a reading', () => {
  it('borrows the tone unknown already uses instead of its own state colour', () => {
    const observed = stateDotClass('idle')
    const guessed = stateDotClass('idle', true)

    expect(guessed).not.toBe(observed)
    // Reuse, not a new class: the palette already holds exactly one tone for "nothing was read".
    expect(guessed).toBe(stateDotClass('unknown'))
  })

  it('names the reason, since a tone cannot carry one', () => {
    expect(stateGlyphLabel('idle')).toBe(STATE_LABEL.idle)

    const label = stateGlyphLabel('idle', true)
    expect(label).toStartWith(STATE_LABEL.idle)
    expect(label).toContain('unconfirmed')
    // A reader who sees the word has to be able to act on it, so it says what was missing.
    expect(label).toContain('no manifest rule matched')
  })
})

describe('a state says where it was read from', () => {
  /**
   * There are four authorities and they differ in what they prove: our own report protocol says
   * `blocked` outright, a matched screen rule saw something positive, the agent's transcript answers
   * only whether a turn is running, and the no-match fallback is a guess. The tool has printed the
   * authority since it existed; the workspace named the vocabulary for it and rendered it nowhere —
   * so the person beside the terminals had the weakest view of the three.
   */
  test('each authority is named, in words rather than in wire values', () => {
    expect(stateGlyphLabel('working', false, 'transcript')).toBe(
      "Working — read from the agent's own transcript",
    )
    expect(stateGlyphLabel('idle', false, 'screen-manifest')).toBe(
      'Idle — read from the screen manifest',
    )
  })

  test('an unconfirmed state keeps saying so, because that is not a source', () => {
    // The fallback is the ABSENCE of a reading; naming an authority for it would dress a guess up
    // as an observation, which is the one thing this vocabulary exists to prevent.
    expect(stateGlyphLabel('idle', true, 'screen-manifest')).toBe(
      'Idle — unconfirmed: no manifest rule matched this screen',
    )
  })

  test('a row with no live observer says only its state', () => {
    // `none` belongs to history rows, which draw no glyph at all — naming it would be noise on a
    // surface that never shows it.
    expect(stateGlyphLabel('idle', false, 'none')).toBe('Idle')
    expect(stateGlyphLabel('idle')).toBe('Idle')
  })

  test('every authority the contract declares has a word for it', () => {
    // A new authority reaching the roster with no label would render `undefined` into the tooltip.
    for (const authority of STATE_AUTHORITIES) {
      expect(AUTHORITY_LABEL[authority], `${authority} has no label`).toBeTruthy()
    }
  })
})
