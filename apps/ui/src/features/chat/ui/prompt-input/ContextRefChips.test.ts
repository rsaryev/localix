import { describe, expect, test } from 'bun:test'

import { contextRefSourceLabel } from './ContextRefChips'

describe('context indicator provenance', () => {
  test('distinguishes automatic, explicit, and in-message context', () => {
    expect(contextRefSourceLabel({ auto: true, pinned: true })).toBe('Automatic · open tab')
    expect(contextRefSourceLabel({ pinned: true })).toBe('Explicit')
    expect(contextRefSourceLabel({ pinned: false })).toBe('Mention in message')
  })

  test('automatic provenance wins over the generic pinned shape', () => {
    expect(contextRefSourceLabel({ auto: true, pinned: false })).toBe('Automatic · open tab')
  })
})
