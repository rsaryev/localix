import { describe, expect, it } from 'bun:test'
import { nextFocusPart, type FocusPart } from './focusRing'

const ALL: FocusPart[] = ['sidebar', 'editor', 'chat']

describe('nextFocusPart', () => {
  it('cycles forward through all present parts', () => {
    expect(nextFocusPart(ALL, 'sidebar', 1)).toBe('editor')
    expect(nextFocusPart(ALL, 'editor', 1)).toBe('chat')
    expect(nextFocusPart(ALL, 'chat', 1)).toBe('sidebar') // wraps
  })

  it('cycles backward through all present parts', () => {
    expect(nextFocusPart(ALL, 'chat', -1)).toBe('editor')
    expect(nextFocusPart(ALL, 'editor', -1)).toBe('sidebar')
    expect(nextFocusPart(ALL, 'sidebar', -1)).toBe('chat') // wraps
  })

  it('skips absent parts (sidebar collapsed → editor ⇄ chat)', () => {
    const present: FocusPart[] = ['editor', 'chat']
    expect(nextFocusPart(present, 'editor', 1)).toBe('chat')
    expect(nextFocusPart(present, 'chat', 1)).toBe('editor')
    expect(nextFocusPart(present, 'chat', -1)).toBe('editor')
  })

  it('enters the ring from the correct end when focus is outside', () => {
    expect(nextFocusPart(ALL, null, 1)).toBe('sidebar')
    expect(nextFocusPart(ALL, null, -1)).toBe('chat')
  })

  it('returns null when there is nowhere to go', () => {
    expect(nextFocusPart([], 'chat', 1)).toBeNull()
    expect(nextFocusPart(['chat'], 'chat', 1)).toBeNull() // only part already focused
    expect(nextFocusPart(['chat'], null, 1)).toBe('chat') // but enter it from outside
  })

  it('re-enters the ring when the focused part is no longer present', () => {
    // Focus was in the sidebar, which just collapsed; ring is editor/chat now.
    const present: FocusPart[] = ['editor', 'chat']
    expect(nextFocusPart(present, 'sidebar', 1)).toBe('editor')
    expect(nextFocusPart(present, 'sidebar', -1)).toBe('chat')
  })
})
