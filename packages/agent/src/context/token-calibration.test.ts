import { describe, expect, test } from 'bun:test'

import {
  calibratedTokens,
  DEFAULT_TOKEN_CALIBRATION,
  IMAGE_TOKENS_BOUNDS,
  MIN_CALIBRATION_TEXT_TOKENS,
  observeTokenCalibration,
  TEXT_SCALE_BOUNDS,
} from './token-calibration'

describe("token calibration — learning the heuristic's error from provider usage", () => {
  test('a text-only request teaches the text scale; the first sample is taken as is', () => {
    // Measured on a real session: the byte heuristic said ~103k for a request the provider billed at ~48k.
    const learned = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 100_000, images: 0 },
      48_000,
      3_000,
    )
    expect(learned.samples).toBe(1)
    expect(learned.textScale).toBeCloseTo(48_000 / 103_000, 3)
    expect(learned.imageTokens).toBe(DEFAULT_TOKEN_CALIBRATION.imageTokens)
  })

  test('later samples move by an EMA, never a jump', () => {
    const first = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 50_000, images: 0 },
      25_000,
    )
    const second = observeTokenCalibration(first, { textTokens: 50_000, images: 0 }, 50_000)
    expect(second.textScale).toBeGreaterThan(0.5)
    expect(second.textScale).toBeLessThan(1)
    expect(second.samples).toBe(2)
  })

  test('a request with images teaches the per-image cost at the current text scale', () => {
    const text = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 40_000, images: 0 },
      20_000,
    )
    // 20k of text at scale 0.5 plus 4 images the provider billed at ~300 each.
    const withImages = observeTokenCalibration(
      text,
      { textTokens: 40_000, images: 4 },
      20_000 + 4 * 300,
    )
    expect(withImages.textScale).toBe(text.textScale)
    expect(withImages.imageTokens).toBeCloseTo(300, 0)
  })

  test('an implausible sample teaches nothing instead of being clamped into the average', () => {
    const tiny = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 100_000, images: 0 },
      Math.floor(100_000 * TEXT_SCALE_BOUNDS.min) - 1_000,
    )
    expect(tiny).toBe(DEFAULT_TOKEN_CALIBRATION)
    const huge = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 10_000, images: 0 },
      Math.ceil(10_000 * TEXT_SCALE_BOUNDS.max) + 1_000,
    )
    expect(huge).toBe(DEFAULT_TOKEN_CALIBRATION)
    const text = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 10_000, images: 0 },
      10_000,
    )
    const freeImages = observeTokenCalibration(text, { textTokens: 10_000, images: 2 }, 10_000)
    expect(freeImages).toBe(text)
    expect(IMAGE_TOKENS_BOUNDS.min).toBeGreaterThan(0)
  })

  test('a text-dominant request with a few images teaches the TEXT scale, images at their allowance', () => {
    // An early turn of that session: 22,422 of text + 2 screenshots, measured 29,738 (overhead 19,100).
    const learned = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 22_422, images: 2 },
      29_738,
      19_100,
    )
    expect(learned.samples).toBe(1)
    expect(learned.textScale).toBeCloseTo((29_738 - 2 * 1600) / (22_422 + 19_100), 3)
    expect(learned.imageTokens).toBe(DEFAULT_TOKEN_CALIBRATION.imageTokens)
  })

  test('an image-dominant request before any text sample teaches nothing (replay: 7 screenshots at 64 tokens)', () => {
    // 43,378 measured against ~89k of heuristic text: the residual is negative and would blame
    // the images for the text's error. Wait for a text-only request to fix the scale first.
    const learned = observeTokenCalibration(
      DEFAULT_TOKEN_CALIBRATION,
      { textTokens: 69_933, images: 7 },
      43_378,
      19_100,
    )
    expect(learned).toBe(DEFAULT_TOKEN_CALIBRATION)
  })

  test('nothing to learn: zero usage, or a request that is mostly the fixed floor', () => {
    expect(
      observeTokenCalibration(DEFAULT_TOKEN_CALIBRATION, { textTokens: 50_000, images: 0 }, 0),
    ).toBe(DEFAULT_TOKEN_CALIBRATION)
    expect(
      observeTokenCalibration(
        DEFAULT_TOKEN_CALIBRATION,
        { textTokens: MIN_CALIBRATION_TEXT_TOKENS - 1, images: 0 },
        1_000,
      ),
    ).toBe(DEFAULT_TOKEN_CALIBRATION)
  })

  test('calibrated cost applies the scale to text and the learned cost to images', () => {
    const calibration = { textScale: 0.5, imageTokens: 300, samples: 3, imageSamples: 1 }
    expect(calibratedTokens({ textTokens: 1_000, images: 2 }, calibration)).toBe(1_100)
    expect(calibratedTokens({ textTokens: 1_000, images: 2 }, DEFAULT_TOKEN_CALIBRATION)).toBe(
      1_000 + 2 * DEFAULT_TOKEN_CALIBRATION.imageTokens,
    )
  })
})
