import { describe, expect, it } from 'bun:test'

import { isScrollUpKey } from './useAutoScrollUserInput'

describe('isScrollUpKey', () => {
  it('treats upward navigation keys as scroll-up intent', () => {
    for (const key of ['ArrowUp', 'PageUp', 'Home']) expect(isScrollUpKey(key, false)).toBe(true)
    expect(isScrollUpKey(' ', true)).toBe(true)
  })

  it('ignores downward and unrelated keys', () => {
    for (const key of ['ArrowDown', 'PageDown', 'End', 'a'])
      expect(isScrollUpKey(key, false)).toBe(false)
    expect(isScrollUpKey(' ', false)).toBe(false)
  })
})
