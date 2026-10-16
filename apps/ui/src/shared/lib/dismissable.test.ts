import { describe, expect, test } from 'bun:test'
import { HINT, dismiss, isDismissed, resetDismissed } from '@localixai/kit/lib'

describe('dismissable', () => {
  test('a fresh key is not dismissed', () => {
    expect(isDismissed('hint.fresh')).toBe(false)
  })

  test('dismiss sticks, reset brings it back', () => {
    dismiss('hint.a')
    expect(isDismissed('hint.a')).toBe(true)
    resetDismissed('hint.a')
    expect(isDismissed('hint.a')).toBe(false)
  })

  test('dismissal is per key', () => {
    dismiss('hint.b')
    expect(isDismissed('hint.b')).toBe(true)
    expect(isDismissed('hint.c')).toBe(false)
  })

  test('dismiss is idempotent', () => {
    dismiss('hint.d')
    dismiss('hint.d')
    expect(isDismissed('hint.d')).toBe(true)
  })

  test('the known hint keys are distinct', () => {
    const keys = Object.values(HINT)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
