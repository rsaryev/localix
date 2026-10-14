import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  __resetRootFontPx,
  codeFontSize,
  densityRatio,
  readRootFontPx,
  setRootFontPx,
} from '@localixai/kit/lib'

const scope = globalThis as unknown as Record<string, unknown>
const STUBBED = ['document', 'getComputedStyle'] as const
const saved = new Map(STUBBED.filter((key) => key in scope).map((key) => [key, scope[key]]))

/** A DOM stand-in that counts every computed-style read of `<html>`. */
function fakeRoot(fontSize: string) {
  let reads = 0
  scope.document = { documentElement: {} }
  scope.getComputedStyle = () => {
    reads += 1
    return { fontSize }
  }
  return { reads: () => reads }
}

// The recorded size is module state, and another suite in the same process may have read it
// through a DOM of its own; every case starts unmeasured.
beforeEach(() => __resetRootFontPx())

afterEach(() => {
  // A key that was not there before must be REMOVED, not set to undefined: the test-globals guard
  // counts it as a leak either way.
  for (const key of STUBBED) {
    if (saved.has(key)) scope[key] = saved.get(key)
    else delete scope[key]
  }
  __resetRootFontPx()
})

describe('root font size', () => {
  test('pixel-based code surfaces follow every typography preference without measuring again', () => {
    const root = fakeRoot('14px')
    expect(codeFontSize()).toBe(13)
    for (const size of [13, 14, 15, 16]) {
      setRootFontPx(size)
      expect(codeFontSize()).toBeCloseTo((13 * size) / 14)
    }
    expect(root.reads()).toBe(1)
  })
  // Every grid render asked, and every ask forced a style recalculation of the whole document.
  test('the DOM is measured once, not on every read', () => {
    const root = fakeRoot('15px')
    for (let i = 0; i < 50; i++) expect(readRootFontPx()).toBe(15)
    expect(root.reads()).toBe(1)
  })

  test('the font-size setting updates the value without a measurement', () => {
    const root = fakeRoot('14px')
    expect(densityRatio()).toBe(1)
    setRootFontPx(16)
    expect(readRootFontPx()).toBe(16)
    expect(densityRatio()).toBeCloseTo(16 / 14)
    expect(root.reads()).toBe(1)
  })

  test('an unusable value falls back to the baseline', () => {
    fakeRoot('auto')
    expect(readRootFontPx()).toBe(14)
    setRootFontPx(Number.NaN)
    expect(readRootFontPx()).toBe(14)
  })
})
