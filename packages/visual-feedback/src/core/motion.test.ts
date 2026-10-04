import { describe, expect, test } from 'bun:test'
import { motionSafeScrollBehavior, REDUCED_MOTION_QUERY } from './motion'

describe('in-page runtime motion', () => {
  test('uses the canonical OS preference query', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)')
  })

  test('removes only smooth scrolling when the preview requests reduced motion', () => {
    expect(motionSafeScrollBehavior('smooth', true)).toBe('auto')
    expect(motionSafeScrollBehavior('auto', true)).toBe('auto')
    expect(motionSafeScrollBehavior('smooth', false)).toBe('smooth')
  })
})
