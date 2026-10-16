import { describe, expect, it } from 'bun:test'
import {
  CONNECTION_COLORS,
  connectionBorderLeftClass,
  connectionDotClass,
  connectionTextClass,
  isConnectionColor,
} from './connectionColor'

describe('connectionColor', () => {
  it('maps every palette token to full, static class strings', () => {
    for (const c of CONNECTION_COLORS) {
      expect(connectionDotClass(c)).toBe(`bg-conn-${c}`)
      expect(connectionTextClass(c)).toBe(`text-conn-${c}`)
      expect(connectionBorderLeftClass(c)).toBe(`border-l-conn-${c}`)
    }
  })

  it('returns null for "None" (undefined/null) and unknown tokens', () => {
    for (const bad of [undefined, null, '', 'teal', 'bg-conn-red']) {
      expect(connectionDotClass(bad)).toBeNull()
      expect(connectionTextClass(bad)).toBeNull()
      expect(connectionBorderLeftClass(bad)).toBeNull()
    }
  })

  it('narrows only recognized tokens', () => {
    expect(isConnectionColor('blue')).toBe(true)
    expect(isConnectionColor('mauve')).toBe(false)
    expect(isConnectionColor(undefined)).toBe(false)
  })
})
