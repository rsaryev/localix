import { describe, expect, it } from 'bun:test'
import { nextPromptIndex } from './transcriptNav'

describe('nextPromptIndex', () => {
  const prompts = [1, 4, 9, 15]

  it('finds the next prompt below the anchor', () => {
    expect(nextPromptIndex(prompts, 4, 'next')).toBe(9)
    expect(nextPromptIndex(prompts, 0, 'next')).toBe(1)
    expect(nextPromptIndex(prompts, 5, 'next')).toBe(9)
  })

  it('finds the previous prompt above the anchor', () => {
    expect(nextPromptIndex(prompts, 9, 'prev')).toBe(4)
    expect(nextPromptIndex(prompts, 15, 'prev')).toBe(9)
    expect(nextPromptIndex(prompts, 5, 'prev')).toBe(4)
  })

  it('returns null past the ends', () => {
    expect(nextPromptIndex(prompts, 15, 'next')).toBeNull()
    expect(nextPromptIndex(prompts, 1, 'prev')).toBeNull()
    expect(nextPromptIndex(prompts, 0, 'prev')).toBeNull()
  })

  it('handles an empty prompt list', () => {
    expect(nextPromptIndex([], 3, 'next')).toBeNull()
    expect(nextPromptIndex([], 3, 'prev')).toBeNull()
  })
})
