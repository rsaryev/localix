import { describe, expect, test } from 'bun:test'
import { reasoningBeamIntensity, REASONING_OPTIONS } from './reasoning'

describe('reasoning composer presentation', () => {
  test('never DROPS the shared border-beam intensity as effort rises', () => {
    // Non-decreasing rather than strictly increasing: the beam has six steps and the effort scale
    // has seven, so the top two levels share the strongest weight (see reasoning.ts).
    const beams = REASONING_OPTIONS.map((option) => reasoningBeamIntensity(option.value))
    expect(beams).toEqual([0, 1, 2, 3, 4, 5, 5])
    expect(beams.every((n, i) => i === 0 || n >= beams[i - 1]!)).toBe(true)
  })

  test('gives the top levels the strongest existing beam without inventing another effect', () => {
    // The primitive's own header asks callers not to add effects for their own states; a 7th CSS
    // step would encode a distinction between xhigh and max that the user cannot act on.
    expect(reasoningBeamIntensity('xhigh')).toBe(5)
    expect(reasoningBeamIntensity('max')).toBe(5)
    expect(reasoningBeamIntensity('off')).toBe(0)
  })
})
