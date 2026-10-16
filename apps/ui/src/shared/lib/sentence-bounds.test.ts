import { describe, it, expect } from 'bun:test'
import { sentenceBoundsRegex, sentenceBounds, expandToSentences } from './sentence-bounds'

describe('sentenceBoundsRegex', () => {
  it('returns a single range for text with no terminator', () => {
    expect(sentenceBoundsRegex('hello world')).toEqual([[0, 11]])
  })

  it('splits on terminators, keeping the trailing whitespace with its sentence', () => {
    // "AB. " (0..4) then "CD." (4..7)
    expect(sentenceBoundsRegex('AB. CD.')).toEqual([
      [0, 4],
      [4, 7],
    ])
  })

  it('captures a trailing fragment without a terminator', () => {
    expect(sentenceBoundsRegex('One. Two')).toEqual([
      [0, 5],
      [5, 8],
    ])
  })

  it('treats an ellipsis as a terminator', () => {
    expect(sentenceBoundsRegex('Wait… really?')).toEqual([
      [0, 6],
      [6, 13],
    ])
  })

  it('returns no ranges for an empty string', () => {
    expect(sentenceBoundsRegex('')).toEqual([])
  })

  it('produces a contiguous cover of the whole string', () => {
    const text = 'Alpha! Beta? Gamma.'
    const bounds = sentenceBoundsRegex(text)
    expect(bounds[0][0]).toBe(0)
    expect(bounds[bounds.length - 1][1]).toBe(text.length)
    for (let i = 1; i < bounds.length; i++) expect(bounds[i][0]).toBe(bounds[i - 1][1])
  })
})

describe('sentenceBounds', () => {
  it('covers the whole string contiguously regardless of segmenter availability', () => {
    const text = 'Hello world. How are you?'
    const bounds = sentenceBounds(text)
    expect(bounds.length).toBeGreaterThan(0)
    expect(bounds[0][0]).toBe(0)
    expect(bounds[bounds.length - 1][1]).toBe(text.length)
    for (let i = 1; i < bounds.length; i++) expect(bounds[i][0]).toBe(bounds[i - 1][1])
  })
})

describe('expandToSentences', () => {
  // "AB. CD." → sentence 0 = [0,4) ("AB. "), sentence 1 = [4,7) ("CD.")
  const text = 'AB. CD.'
  const bounds: Array<[number, number]> = [
    [0, 4],
    [4, 7],
  ]

  it('expands a mid-sentence selection to the whole sentence and trims trailing space', () => {
    // select "B" (1..2) → expand to [0,4), trim trailing space → [0,3) = "AB."
    expect(expandToSentences(text, bounds, 1, 2)).toEqual([0, 3])
  })

  it('expands a cross-sentence selection to cover both', () => {
    // select "B. C" (1..5) → touches both → [0,7) = "AB. CD."
    expect(expandToSentences(text, bounds, 1, 5)).toEqual([0, 7])
  })

  it('collapses an all-whitespace touch to an empty window', () => {
    const ws = '  '
    expect(expandToSentences(ws, [[0, 2]], 0, 2)).toEqual([2, 2])
  })

  it('leaves a tight in-sentence selection untouched when it has no surrounding sentence to grow into beyond itself', () => {
    // selecting the full first sentence text minus the space still trims to [0,3)
    expect(expandToSentences(text, bounds, 0, 4)).toEqual([0, 3])
  })
})
